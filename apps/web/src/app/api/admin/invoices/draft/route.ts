import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { buildCounterpartyBillingSnapshot } from "@/server/billing/counterpartyBillingSnapshot";
import {
  computeSectionMonthRevenue,
  loadCarrierCodeByCourse,
} from "@/server/billing/computeCounterpartyMonthRevenue";
import { computeDriverAutoPayout } from "@/server/billing/driverPayout";
import { loadDriverLease, loadCourseDailyLease, computeLeaseDeduction } from "@/server/billing/driverLease";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

export const dynamic = "force-dynamic";

type Section = "Amazon" | "ヤマト運輸" | "郵便局";

function normalizeCounterpartyToken(name: string | null | undefined) {
  const token = String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return token || null;
}

function buildInvoiceNo(params: {
  month: string;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
}) {
  const ym = params.month.replace("-", "");
  const byName = normalizeCounterpartyToken(params.counterpartyName);
  const byId = params.counterpartyId
    ? params.counterpartyId.replace(/-/g, "").slice(0, 4).toUpperCase()
    : null;
  const cp = byName || byId || "GEN";
  return `INV-${ym}-${cp}`;
}

/**
 * "{base}-R{NN}" 形式の次リビジョン番号を確定する（outgoing/incoming共用）。
 * invoice_no を降順で取得し最大リビジョンを確定する。
 * 旧実装は無順序 .limit(300) のため 300 件超でページング欠落→採番重複の恐れがあった。
 * ゼロ詰め2桁前提なので降順上位を見れば十分（書式ゆらぎに備え reduce で最大値を取る）。
 */
async function nextRevisionForBase(orgId: string, base: string): Promise<string> {
  const prefix = `${base}-R`;
  const { data, error } = await supabase
    .from("invoice_documents")
    .select("invoice_no")
    .eq("org_id", orgId)
    .like("invoice_no", `${prefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(100);
  if (error) throw error;
  const maxRevision = (data ?? []).reduce((max, row: Record<string, unknown>) => {
    const no = String(row.invoice_no ?? "");
    const m = no.match(new RegExp(`^${prefix}(\\d{2})$`));
    if (!m) return max;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return max;
    return Math.max(max, n);
  }, -1);
  // R99 到達時はクランプすると重複するため、3桁へ桁上げして重複を避ける。
  const nextRevision = maxRevision + 1;
  return `${prefix}${String(nextRevision).padStart(2, "0")}`;
}

async function buildNextInvoiceNo(
  orgId: string,
  params: {
    month: string;
    counterpartyId?: string | null;
    counterpartyName?: string | null;
  }
): Promise<string> {
  return nextRevisionForBase(orgId, buildInvoiceNo(params));
}

/** 受領請求書（ドライバー宛）の番号ベース："IN-{yyyymm}-{driverIdの先頭4桁16進を大文字化}"。 */
function buildIncomingInvoiceNo(driverId: string, month: string): string {
  const ym = month.replace("-", "");
  const token = driverId.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `IN-${ym}-${token}`;
}

async function buildNextIncomingInvoiceNo(orgId: string, driverId: string, month: string): Promise<string> {
  return nextRevisionForBase(orgId, buildIncomingInvoiceNo(driverId, month));
}

function getMonthRange(monthParam: string | null): { month: string; startDate: string; endDate: string } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    month: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function nextMonthEndDate(month: string): string {
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const ny = mm === 12 ? y + 1 : y;
  const nm = mm === 12 ? 1 : mm + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** セクション合計は v2 集計（computeSectionMonthRevenue）へ委譲。郵便局は sales_log COMPANY。 */
async function computeTotalForSection(orgId: string, startDate: string, endDate: string, section: Section) {
  return computeSectionMonthRevenue(supabase, orgId, startDate, endDate, section);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const monthParam = req.nextUrl.searchParams.get("month");
  const sectionParamRaw = req.nextUrl.searchParams.get("section");
  const section: Section =
    sectionParamRaw === "Amazon" || sectionParamRaw === "ヤマト運輸" || sectionParamRaw === "郵便局"
      ? sectionParamRaw
      : "ヤマト運輸";

  const range = getMonthRange(monthParam);
  const issueDate = todayIsoDate();
  const dueDate = nextMonthEndDate(range.month);
  const counterpartyParam = req.nextUrl.searchParams.get("counterparty")?.trim() ?? "";
  const driverParam = req.nextUrl.searchParams.get("driver")?.trim() ?? "";

  // 受領請求書（ドライバー宛）: コース単価×日報実績＋固定経費・臨時経費を自動集計する。
  if (driverParam && UUID_RE.test(driverParam)) {
    const { data: driver, error: driverErr } = await supabase
      .from("drivers")
      .select("id, name, postal_code, address, phone, bank_name, bank_no, bank_holder")
      .eq("id", driverParam)
      .eq("org_id", orgId)
      .maybeSingle();

    if (driverErr) {
      console.error(driverErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!driver) {
      return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
    }

    const autoPayout = await computeDriverAutoPayout(supabase, orgId, driverParam, range.startDate, range.endDate);
    const main: { title: string; qty: number; price: number; unit?: string }[] = autoPayout.lines.map((l) => ({
      title: l.title,
      qty: l.qty,
      price: l.unitPrice,
      unit: l.unitId ? "個" : "日",
    }));
    const deduct: { title: string; qty: number; price: number; unit?: string }[] = [];

    // 固定経費（driver_fixed_expenses・月額）→ お支払い分。
    const { data: fixedExpRows } = await supabase
      .from("driver_fixed_expenses")
      .select("name, amount")
      .eq("driver_id", driverParam)
      .eq("cycle", "MONTHLY")
      .lte("valid_from", range.endDate)
      .or(`valid_to.is.null,valid_to.gte.${range.startDate}`);
    (fixedExpRows ?? []).forEach((r: { name: string; amount: number }) => {
      deduct.push({ title: r.name, qty: 1, price: Number(r.amount) || 0, unit: "" });
    });

    // 臨時経費（driver_ad_hoc_expenses・当月）: 正=控除（お支払い分）、負=手当（請求分へ加算）。
    const { data: adHocRows } = await supabase
      .from("driver_ad_hoc_expenses")
      .select("name, amount")
      .eq("driver_id", driverParam)
      .eq("month", range.month);
    (adHocRows ?? []).forEach((r: { name: string; amount: number }) => {
      const amount = Number(r.amount) || 0;
      if (amount > 0) {
        deduct.push({ title: r.name, qty: 1, price: amount, unit: "" });
      } else if (amount < 0) {
        main.push({ title: `${r.name}（手当）`, qty: 1, price: -amount, unit: "" });
      }
    });

    // リース控除（driver_leases・専用概念）。DAILYはコース日額(courses.daily_lease)由来。
    const [lease, courseDailyLease] = await Promise.all([
      loadDriverLease(supabase, driverParam, range.startDate, range.endDate),
      loadCourseDailyLease(supabase, orgId),
    ]);
    const perDay = autoPayout.days.map((d) => ({ date: d.date, courseId: d.courseId }));
    const leaseDeduction = computeLeaseDeduction(lease, perDay, courseDailyLease);
    if (leaseDeduction > 0) {
      deduct.push({ title: "リース代", qty: 1, price: leaseDeduction, unit: "" });
    }

    if (main.length === 0) {
      main.push({ title: `${driver.name} ${range.month}分（明細なし）`, qty: 1, price: 0 });
    }

    return NextResponse.json({
      month: range.month,
      section,
      issueDate,
      dueDate,
      invoiceNo: await buildNextIncomingInvoiceNo(orgId, driverParam, range.month),
      driver: {
        id: driver.id,
        name: driver.name,
        postalCode: driver.postal_code,
        address: driver.address,
        phone: driver.phone,
        bankName: driver.bank_name,
        bankNo: driver.bank_no,
        bankHolder: driver.bank_holder,
      },
      tableData: { main, deduct },
    });
  }

  if (counterpartyParam && UUID_RE.test(counterpartyParam)) {
    const { data: addr, error: addrErr } = await supabase
      .from("invoice_addresses")
      .select("id, name")
      .eq("id", counterpartyParam)
      .eq("org_id", orgId)
      .maybeSingle();

    if (addrErr) {
      console.error(addrErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!addr) {
      return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
    }

    const snap = await buildCounterpartyBillingSnapshot(
      supabase,
      orgId,
      user.companyCode,
      counterpartyParam,
      range.startDate,
      range.endDate,
      range.month
    );

    const main: { title: string; qty: number; price: number }[] = snap.mainLines.map((line) => ({
      title: line.label,
      qty: line.quantity,
      price: line.unitPrice,
    }));

    const deduct: { title: string; qty: number; price: number }[] = snap.deductLines.map((line) => ({
      title: line.label,
      qty: line.quantity,
      price: line.unitPrice,
    }));

    if (main.length === 0) {
      main.push({
        title: `${addr.name} ${range.month} 分（明細なし）`,
        qty: 1,
        price: 0,
      });
    }

    const tableData = {
      main,
      deduct,
    };

    return NextResponse.json({
      month: range.month,
      section,
      issueDate,
      dueDate,
      invoiceNo: await buildNextInvoiceNo(orgId, {
        month: range.month,
        counterpartyId: counterpartyParam,
        counterpartyName: addr.name,
      }),
      counterparty_invoice_address_id: counterpartyParam,
      tableData,
    });
  }

  const total = await computeTotalForSection(orgId, range.startDate, range.endDate, section);

  // section と月内シフトから、請求先ID（取引先ID）を頻度ベースで決める。
  // shifts に org_id 列が無いため、まず自org のコースだけを取得し、shifts 側を
  // その course_id 集合で絞り込む（他orgのシフト/コースが頻度カウントに混入し、
  // 誤った他org宛の取引先IDを返してしまわないようにする）。
  const { data: coursesForTo } = await supabase
    .from("courses")
    .select("id, counterparty_invoice_address_id")
    .eq("org_id", orgId);
  const cMap = new Map<string, any>();
  (coursesForTo ?? []).forEach((c: any) => cMap.set(c.id, c));
  const orgCourseIds = Array.from(cMap.keys());
  // IN 句はコース数が増えるとURL上限で壊れるため分割し、1000行サイレント切り詰めを
  // 避けるため fetchAllRows でページングする（頻度カウントの静かな欠落防止）。
  const shiftsForTo: any[] = [];
  try {
    for (let i = 0; i < orgCourseIds.length; i += IN_CLAUSE_BATCH_SIZE) {
      const slice = orgCourseIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
      const rows = await fetchAllRows((from, to) =>
        supabase
          .from("shifts")
          .select("id, course_id, shift_date")
          .gte("shift_date", range.startDate)
          .lte("shift_date", range.endDate)
          .in("course_id", slice)
          // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
          .order("shift_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      shiftsForTo.push(...rows);
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  // carrier 判定は carriers マスタ（carrier_id → code）由来
  const carrierCodeByCourse = await loadCarrierCodeByCourse(supabase, orgId);
  const counterpartyCount = new Map<string, number>();
  (shiftsForTo ?? []).forEach((s: any) => {
    const c = cMap.get(s.course_id);
    if (!c) return;
    const code = carrierCodeByCourse.get(String(s.course_id)) ?? null;
    const bucket = code === "AMAZON" ? "AMAZON" : code === "YAMATO" ? "YAMATO" : "OTHER";
    // 旧ロジック踏襲: Amazon=AMAZON / ヤマト運輸=非AMAZON / 郵便局=OTHER
    const isTarget =
      section === "Amazon"
        ? bucket === "AMAZON"
        : section === "ヤマト運輸"
          ? bucket !== "AMAZON"
          : bucket === "OTHER";
    if (!isTarget) return;
    const toId = c.counterparty_invoice_address_id as string | null;
    if (!toId) return;
    counterpartyCount.set(toId, (counterpartyCount.get(toId) ?? 0) + 1);
  });
  const sortedTo = Array.from(counterpartyCount.entries()).sort((a, b) => b[1] - a[1]);
  const counterpartyInvoiceAddressId = sortedTo.length > 0 ? sortedTo[0][0] : null;

  const tableData = {
    main: [
      {
        // データが無い月は UUID 経路と表記を揃える（明細なしを明示）。
        title: total > 0 ? `${section} ${range.month} 売上` : `${section} ${range.month} 分（明細なし）`,
        qty: 1,
        price: total,
      },
    ],
    deduct: [],
  };

  return NextResponse.json({
    month: range.month,
    section,
    issueDate,
    dueDate,
    invoiceNo: await buildNextInvoiceNo(orgId, {
      month: range.month,
      counterpartyId: counterpartyInvoiceAddressId,
    }),
    counterparty_invoice_address_id: counterpartyInvoiceAddressId,
    tableData,
  });
}

