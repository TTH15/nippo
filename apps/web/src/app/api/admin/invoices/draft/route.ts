import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  computeSectionMonthRevenue,
  loadCarrierCodeByCourse,
} from "@/server/billing/computeCounterpartyMonthRevenue";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import {
  UUID_RE,
  buildCounterpartyDraft,
  buildDriverDraft,
  buildNextInvoiceNo,
  getMonthRange,
  nextMonthEndDate,
  normalizeSection,
  todayIsoDate,
  type Section,
} from "@/server/billing/invoiceDraft";

export const dynamic = "force-dynamic";

/** セクション合計は v2 集計（computeSectionMonthRevenue）へ委譲。郵便局は sales_log COMPANY。 */
async function computeTotalForSection(orgId: string, startDate: string, endDate: string, section: Section) {
  return computeSectionMonthRevenue(supabase, orgId, startDate, endDate, section);
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const monthParam = req.nextUrl.searchParams.get("month");
  const section = normalizeSection(req.nextUrl.searchParams.get("section"));

  const range = getMonthRange(monthParam);
  const issueDate = todayIsoDate();
  const dueDate = nextMonthEndDate(range.month);
  const counterpartyParam = req.nextUrl.searchParams.get("counterparty")?.trim() ?? "";
  const driverParam = req.nextUrl.searchParams.get("driver")?.trim() ?? "";

  // 受領請求書（ドライバー宛）: コース単価×日報実績＋固定経費・臨時経費を自動集計する。
  if (driverParam && UUID_RE.test(driverParam)) {
    let draft;
    try {
      draft = await buildDriverDraft(supabase, orgId, driverParam, range, section);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!draft) {
      return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
    }
    return NextResponse.json(draft);
  }

  if (counterpartyParam && UUID_RE.test(counterpartyParam)) {
    let draft;
    try {
      draft = await buildCounterpartyDraft(
        supabase,
        orgId,
        user.companyCode,
        counterpartyParam,
        range,
        section,
      );
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!draft) {
      return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
    }
    // 編集画面は counterparty_invoice_address_id（スネークケース）で読む
    return NextResponse.json({ ...draft, counterparty_invoice_address_id: draft.counterparty.id });
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
    invoiceNo: await buildNextInvoiceNo(supabase, orgId, {
      month: range.month,
      counterpartyId: counterpartyInvoiceAddressId,
    }),
    counterparty_invoice_address_id: counterpartyInvoiceAddressId,
    tableData,
  });
}

