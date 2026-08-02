// ============================================================
// 集計刷新: 新テーブルから集計入力を読み出すローダ（Supabase 依存）
// compute.ts（純関数）に渡す形へ正規化する。
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrgCarrierIds } from "@/server/carriers/orgCarriers";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "./pagination";
import type {
  CourseFixedRate,
  CourseUnitRate,
  DailyReport,
  LedgerEntry,
  ReportEntry,
  UnitDef,
} from "./types";

export type CarrierInfo = { id: string; code: string | null };

export type AggregationData = {
  carriers: CarrierInfo[];
  units: UnitDef[];
  unitRates: CourseUnitRate[];
  fixedRates: CourseFixedRate[];
  reports: DailyReport[];
  ledger: LedgerEntry[];
};

export async function loadAggregationData(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<AggregationData> {
  // キャリアは共有マスタ＋会社別有効化（company_carriers）。当 org が有効化した
  // キャリア集合に carriers / units を絞る（ACE は全有効＝従来どおり）。
  // 未設定（null）の場合は全キャリアにフォールバック（移行期に既存挙動を壊さない）。
  const orgCarrierIds = await loadOrgCarrierIds(supabase, orgId);

  // org_id を持つ高頻度テーブル（daily_reports_v2 / ledger_entries）はテナントで絞る。
  // unit_fields/各rate は子テーブル（unit/course 経由で決まる）ため、絞った units/reports
  // に紐づくものだけが参照される。
  const carriersQ = supabase.from("carriers").select("id, code");
  const unitsQ = supabase.from("units").select("id, carrier_id, code, billing_type");
  const [
    { data: carriers },
    { data: units },
    { data: unitFields },
    { data: unitRates },
    { data: fixedRates },
    reportRows,
    ledgerRows,
  ] = await Promise.all([
    orgCarrierIds ? carriersQ.in("id", orgCarrierIds) : carriersQ,
    orgCarrierIds ? unitsQ.in("carrier_id", orgCarrierIds) : unitsQ,
    supabase.from("unit_fields").select("unit_id, field_key, is_billable"),
    supabase
      .from("course_unit_rates")
      .select("course_id, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit"),
    supabase
      .from("course_fixed_rates")
      .select("course_id, fixed_revenue, fixed_profit, fixed_payout"),
    fetchAllRows((from, to) =>
      supabase
        .from("daily_reports_v2")
        .select("id, driver_id, report_date, course_id, carrier_id, approved_at, rejected_at")
        .eq("org_id", orgId)
        .gte("report_date", startDate)
        .lte("report_date", endDate)
        // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
        .order("report_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("ledger_entries")
        .select(
          "entry_date, revenue_delta, profit_delta, payout_delta, target_driver_id, course_id, counterparty_invoice_address_id",
        )
        .eq("org_id", orgId)
        .gte("entry_date", startDate)
        .lte("entry_date", endDate)
        // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
        .order("entry_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  // unit_fields を unit ごとにまとめる
  const fieldsByUnit = new Map<string, { fieldKey: string; isBillable: boolean }[]>();
  (unitFields ?? []).forEach((f: any) => {
    const arr = fieldsByUnit.get(f.unit_id) ?? [];
    arr.push({ fieldKey: f.field_key, isBillable: !!f.is_billable });
    fieldsByUnit.set(f.unit_id, arr);
  });

  const unitDefs: UnitDef[] = (units ?? []).map((u: any) => ({
    id: u.id,
    carrierId: u.carrier_id,
    code: u.code ?? null,
    billingType: u.billing_type,
    fields: fieldsByUnit.get(u.id) ?? [],
  }));

  // report_entries を該当 report に紐付け（id 数・行数がともに多い場合に備え、
  // in() 対象を1000件ずつ分割しつつ、各分割も range() でページングする）
  const reportIds = (reportRows ?? []).map((r: any) => r.id);
  const entriesByReport = new Map<string, ReportEntry[]>();
  if (reportIds.length > 0) {
    for (let i = 0; i < reportIds.length; i += IN_CLAUSE_BATCH_SIZE) {
      const slice = reportIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
      const entRows = await fetchAllRows((from, to) =>
        supabase
          .from("report_entries")
          .select("report_id, unit_id, field_key, value_num")
          .in("report_id", slice)
          // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
          .order("id", { ascending: true })
          .range(from, to),
      );
      entRows.forEach((e: any) => {
        const arr = entriesByReport.get(e.report_id) ?? [];
        arr.push({ unitId: e.unit_id, fieldKey: e.field_key, valueNum: Number(e.value_num) || 0 });
        entriesByReport.set(e.report_id, arr);
      });
    }
  }

  const reports: DailyReport[] = (reportRows ?? []).map((r: any) => ({
    id: r.id,
    driverId: r.driver_id,
    reportDate: r.report_date,
    courseId: r.course_id ?? null,
    carrierId: r.carrier_id ?? null,
    approvedAt: r.approved_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    entries: entriesByReport.get(r.id) ?? [],
  }));

  return {
    carriers: (carriers ?? []).map((c: any) => ({ id: c.id, code: c.code ?? null })),
    units: unitDefs,
    unitRates: (unitRates ?? []).map((r: any) => ({
      courseId: r.course_id,
      unitId: r.unit_id,
      revenuePerUnit: Number(r.revenue_per_unit) || 0,
      profitPerUnit: Number(r.profit_per_unit) || 0,
      payoutPerUnit: Number(r.payout_per_unit) || 0,
    })),
    fixedRates: (fixedRates ?? []).map((r: any) => ({
      courseId: r.course_id,
      fixedRevenue: Number(r.fixed_revenue) || 0,
      fixedProfit: Number(r.fixed_profit) || 0,
      fixedPayout: Number(r.fixed_payout) || 0,
    })),
    reports,
    ledger: (ledgerRows ?? []).map((l: any) => ({
      entryDate: l.entry_date,
      revenueDelta: Number(l.revenue_delta) || 0,
      profitDelta: Number(l.profit_delta) || 0,
      payoutDelta: Number(l.payout_delta) || 0,
      targetDriverId: l.target_driver_id ?? null,
      courseId: l.course_id ?? null,
      counterpartyInvoiceAddressId: l.counterparty_invoice_address_id ?? null,
    })),
  };
}
