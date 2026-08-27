// ============================================================
// 集計刷新: 新テーブルから集計入力を読み出すローダ（Supabase 依存）
// compute.ts（純関数）に渡す形へ正規化する。
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrgCarrierIds } from "@/server/carriers/orgCarriers";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "./pagination";
import type {
  CourseFixedRate,
  CourseFixedRateBundle,
  CourseRateModes,
  CourseUnitRate,
  RateMode,
  DailyReport,
  LedgerEntry,
  ReportEntry,
  UnitDef,
} from "./types";

export type CarrierInfo = { id: string; code: string | null };

const RATE_MODES: RateMode[] = ["NONE", "PER_PIECE", "FIXED", "BOTH"];
/** 列が未適用/NULL のときは従来挙動（単価行の値をそのまま使う）へフォールバックする。 */
const rateMode = (value: unknown): RateMode =>
  RATE_MODES.includes(value as RateMode) ? (value as RateMode) : "BOTH";

export type AggregationData = {
  carriers: CarrierInfo[];
  units: UnitDef[];
  courseRateModes: CourseRateModes[];
  unitRates: CourseUnitRate[];
  fixedRates: CourseFixedRate[];
  fixedRateBundles: CourseFixedRateBundle[];
  reports: DailyReport[];
  ledger: LedgerEntry[];
};

export type LoadAggregationOptions = {
  /** 特定ドライバーの日報だけを読む（本人向け報酬計算など）。マスタ・単価は全量のまま。 */
  driverId?: string;
  /** 特定コース集合の日報だけを読む（取引先別の明細など）。IN 分割は内部で行う。 */
  courseIds?: string[];
  /** 台帳(ledger_entries)を読まない（payout 計算など ledger 不要の呼び出しで転送を省く）。既定 true。 */
  withLedger?: boolean;
};

export async function loadAggregationData(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  options: LoadAggregationOptions = {},
): Promise<AggregationData> {
  // キャリアは共有マスタ＋会社別有効化（company_carriers）。当 org が有効化した
  // キャリア集合に carriers / units を絞る（ACE は全有効＝従来どおり）。
  // 未設定（null）の場合は全キャリアにフォールバック（移行期に既存挙動を壊さない）。
  const orgCarrierIds = await loadOrgCarrierIds(supabase, orgId);

  // org_id を持つ高頻度テーブル（daily_reports_v2 / ledger_entries）はテナントで絞る。
  // unit_fields/各rate は子テーブル（unit/course 経由で決まる）ため、絞った units/reports
  // に紐づくものだけが参照される。
  // マスタ・単価テーブルも fetchAllRows で全件取得する（素SELECTは1000行で
  // サイレント切り詰め＝単価が黙って欠落し、過少請求/過少支払につながる）。
  const [
    carriers,
    units,
    courseModeRows,
    unitFields,
    fixedRateBundles,
    unitRates,
    fixedRates,
    reportRows,
    ledgerRows,
  ] = await Promise.all([
    fetchAllRows((from, to) => {
      const q = supabase.from("carriers").select("id, code");
      return (orgCarrierIds ? q.in("id", orgCarrierIds) : q)
        .order("id", { ascending: true })
        .range(from, to);
    }),
    fetchAllRows((from, to) => {
      const q = supabase.from("units").select("id, carrier_id, code, billing_type");
      return (orgCarrierIds ? q.in("carrier_id", orgCarrierIds) : q)
        .order("id", { ascending: true })
        .range(from, to);
    }),
    fetchAllRows((from, to) =>
      supabase
        // コースの計算方式(NONE/PER_PIECE/FIXED/BOTH)は単価行より上位の正本。
        // 「自動支払なし」のコースへ古い支払単価が残っていても集計に載せない。
        .from("courses")
        .select("id, revenue_rate_mode, payout_rate_mode")
        .eq("org_id", orgId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("unit_fields")
        .select("unit_id, field_key, is_billable")
        // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("course_fixed_rate_bundles")
        .select("course_id, required_cycle_nos, fixed_revenue, fixed_payout")
        .order("course_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("course_unit_rates")
        .select("course_id, cycle_no, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit, revenue_contract_amount, payout_contract_amount, revenue_quantity_rule, payout_quantity_rule")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("course_fixed_rates")
        .select("course_id, cycle_no, fixed_revenue, fixed_profit, fixed_payout, revenue_contract_amount, payout_contract_amount")
        // PK は course_id（id 列なし）
        .order("course_id", { ascending: true })
        .range(from, to),
    ),
    (async () => {
      const fetchReportsPage = (courseSlice: string[] | null) =>
        fetchAllRows((from, to) => {
          let q = supabase
            .from("daily_reports_v2")
            .select("id, driver_id, report_date, course_id, cycle_no, carrier_id, approved_at, rejected_at, rate_snapshot")
            .eq("org_id", orgId)
            .gte("report_date", startDate)
            .lte("report_date", endDate);
          if (options.driverId) q = q.eq("driver_id", options.driverId);
          if (courseSlice) q = q.in("course_id", courseSlice);
          // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
          return q
            .order("report_date", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);
        });
      if (!options.courseIds) return fetchReportsPage(null);
      if (options.courseIds.length === 0) return [];
      // IN 句は URL 上限を超えないよう分割する
      const out: Awaited<ReturnType<typeof fetchReportsPage>> = [];
      for (let i = 0; i < options.courseIds.length; i += IN_CLAUSE_BATCH_SIZE) {
        out.push(...(await fetchReportsPage(options.courseIds.slice(i, i + IN_CLAUSE_BATCH_SIZE))));
      }
      return out;
    })(),
    options.withLedger === false
      ? Promise.resolve([])
      : fetchAllRows((from, to) =>
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
    cycleNo: Number(r.cycle_no) || 0,
    carrierId: r.carrier_id ?? null,
    approvedAt: r.approved_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    rateSnapshot: r.rate_snapshot ?? null,
    entries: entriesByReport.get(r.id) ?? [],
  }));

  return {
    carriers: (carriers ?? []).map((c: any) => ({ id: c.id, code: c.code ?? null })),
    units: unitDefs,
    courseRateModes: (courseModeRows ?? []).map((c: any) => ({
      courseId: c.id,
      revenueRateMode: rateMode(c.revenue_rate_mode),
      payoutRateMode: rateMode(c.payout_rate_mode),
    })),
    unitRates: (unitRates ?? []).map((r: any) => ({
      courseId: r.course_id,
      cycleNo: Number(r.cycle_no) || 0,
      unitId: r.unit_id,
      revenuePerUnit: Number(r.revenue_per_unit) || 0,
      profitPerUnit: Number(r.profit_per_unit) || 0,
      payoutPerUnit: Number(r.payout_per_unit) || 0,
      revenueContractAmount: r.revenue_contract_amount == null ? undefined : Number(r.revenue_contract_amount) || 0,
      payoutContractAmount: r.payout_contract_amount == null ? undefined : Number(r.payout_contract_amount) || 0,
      revenueQuantityRule: r.revenue_quantity_rule ?? { kind: "actual" },
      payoutQuantityRule: r.payout_quantity_rule ?? { kind: "actual" },
    })),
    fixedRates: (fixedRates ?? []).map((r: any) => ({
      courseId: r.course_id,
      cycleNo: Number(r.cycle_no) || 0,
      fixedRevenue: Number(r.fixed_revenue) || 0,
      fixedProfit: Number(r.fixed_profit) || 0,
      fixedPayout: Number(r.fixed_payout) || 0,
      revenueContractAmount: r.revenue_contract_amount == null ? undefined : Number(r.revenue_contract_amount) || 0,
      payoutContractAmount: r.payout_contract_amount == null ? undefined : Number(r.payout_contract_amount) || 0,
    })),
    fixedRateBundles: (fixedRateBundles ?? []).map((r: any) => ({
      courseId: r.course_id,
      requiredCycleNos: Array.isArray(r.required_cycle_nos) ? r.required_cycle_nos.map(Number) : [],
      fixedRevenue: r.fixed_revenue == null ? null : Number(r.fixed_revenue),
      fixedPayout: r.fixed_payout == null ? null : Number(r.fixed_payout),
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
