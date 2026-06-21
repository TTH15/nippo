// ============================================================
// 集計刷新: 新テーブルから集計入力を読み出すローダ（Supabase 依存）
// compute.ts（純関数）に渡す形へ正規化する。
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
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

const BIG = 100000;

export async function loadAggregationData(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<AggregationData> {
  const [
    { data: carriers },
    { data: units },
    { data: unitFields },
    { data: unitRates },
    { data: fixedRates },
    { data: reportRows },
    { data: ledgerRows },
  ] = await Promise.all([
    supabase.from("carriers").select("id, code"),
    supabase.from("units").select("id, carrier_id, code, billing_type"),
    supabase.from("unit_fields").select("unit_id, field_key, is_billable"),
    supabase
      .from("course_unit_rates")
      .select("course_id, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit"),
    supabase
      .from("course_fixed_rates")
      .select("course_id, fixed_revenue, fixed_profit, fixed_payout"),
    supabase
      .from("daily_reports_v2")
      .select("id, driver_id, report_date, course_id, carrier_id, approved_at, rejected_at")
      .gte("report_date", startDate)
      .lte("report_date", endDate)
      .limit(BIG),
    supabase
      .from("ledger_entries")
      .select(
        "entry_date, revenue_delta, profit_delta, payout_delta, target_driver_id, course_id, counterparty_invoice_address_id",
      )
      .gte("entry_date", startDate)
      .lte("entry_date", endDate)
      .limit(BIG),
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

  // report_entries を該当 report に紐付け
  const reportIds = (reportRows ?? []).map((r: any) => r.id);
  const entriesByReport = new Map<string, ReportEntry[]>();
  if (reportIds.length > 0) {
    // id 数が多い場合に備え 1000 件ずつ分割取得
    for (let i = 0; i < reportIds.length; i += 1000) {
      const slice = reportIds.slice(i, i + 1000);
      const { data: entRows } = await supabase
        .from("report_entries")
        .select("report_id, unit_id, field_key, value_num")
        .in("report_id", slice)
        .limit(BIG);
      (entRows ?? []).forEach((e: any) => {
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
