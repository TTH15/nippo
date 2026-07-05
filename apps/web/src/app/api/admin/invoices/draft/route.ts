import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { buildCounterpartyBillingSnapshot } from "@/server/billing/counterpartyBillingSnapshot";
import {
  computeSectionMonthRevenue,
  loadCarrierCodeByCourse,
} from "@/server/billing/computeCounterpartyMonthRevenue";

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

async function buildNextInvoiceNo(
  orgId: string,
  params: {
    month: string;
    counterpartyId?: string | null;
    counterpartyName?: string | null;
  }
): Promise<string> {
  const base = buildInvoiceNo(params);
  const prefix = `${base}-R`;
  // invoice_no を降順で取得し最大リビジョンを確定する。
  // 旧実装は無順序 .limit(300) のため 300 件超でページング欠落→採番重複の恐れがあった。
  // ゼロ詰め2桁前提なので降順上位を見れば十分（書式ゆらぎに備え reduce で最大値を取る）。
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

  // section と月内シフトから、請求先ID（取引先ID）を頻度ベースで決める
  const { data: shiftsForTo } = await supabase
    .from("shifts")
    .select("course_id, shift_date")
    .gte("shift_date", range.startDate)
    .lte("shift_date", range.endDate);
  const { data: coursesForTo } = await supabase
    .from("courses")
    .select("id, counterparty_invoice_address_id")
    .in("id", Array.from(new Set((shiftsForTo ?? []).map((s: any) => s.course_id).filter(Boolean))));
  const cMap = new Map<string, any>();
  (coursesForTo ?? []).forEach((c: any) => cMap.set(c.id, c));
  // carrier 判定は carriers マスタ（carrier_id → code）由来
  const carrierCodeByCourse = await loadCarrierCodeByCourse(supabase);
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

