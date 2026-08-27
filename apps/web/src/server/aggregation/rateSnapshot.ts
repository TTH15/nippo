import type { SupabaseClient } from "@supabase/supabase-js";
import { exclusiveContractTotal, exclusiveUnitPriceOf, roundUnitPrice } from "@repo/core/logic/taxBasis";
import { applyQuantityRule } from "@/server/billing/quantityRule";

export type ReportRateSnapshotComponent = {
  kind: "unit" | "fixed";
  unitId: string | null;
  quantity: number;
  actualQuantity?: number;
  revenueContractAmount: number;
  revenueBasis: "exclusive" | "inclusive";
  payoutContractAmount: number;
  payoutBasis: "exclusive" | "inclusive";
  revenue: number;
  payout: number;
  profit: number;
};

export type ReportRateSnapshot = {
  version: 1;
  capturedAt: string;
  components: ReportRateSnapshotComponent[];
  fixedBundle?: {
    requiredCycleNos: number[];
    fixedRevenue: number | null;
    fixedPayout: number | null;
  };
};

const n = (value: unknown) => Math.trunc(Number(value) || 0);
/** 契約単価は小数を許す（例: 157.5円/個）。金額の丸めは行合計で1回だけ行う。 */
const price = (value: unknown) => roundUnitPrice(Number(value) || 0);

export function selectEffectiveRateVersion<T extends { course_id: string; effective_from: string }>(
  versions: T[],
  courseId: string,
  reportDate: string,
): T | null {
  return versions
    .filter((v) => v.course_id === courseId && String(v.effective_from) <= reportDate)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] ?? null;
}

export function resolveCategoryTaxBases(versionData: any, course: any) {
  const legacyRevenueBasis = (versionData?.revenueTaxBasis ?? course.revenue_tax_basis) === "inclusive" ? "inclusive" : "exclusive";
  const legacyPayoutBasis = (versionData?.payoutTaxBasis ?? course.payout_tax_basis) === "inclusive" ? "inclusive" : "exclusive";
  return {
    revenuePieceBasis: (versionData?.revenuePieceTaxBasis ?? course.revenue_piece_tax_basis ?? legacyRevenueBasis) === "inclusive" ? "inclusive" : "exclusive",
    payoutPieceBasis: (versionData?.payoutPieceTaxBasis ?? course.payout_piece_tax_basis ?? legacyPayoutBasis) === "inclusive" ? "inclusive" : "exclusive",
    revenueFixedBasis: (versionData?.revenueFixedTaxBasis ?? course.revenue_fixed_tax_basis ?? legacyRevenueBasis) === "inclusive" ? "inclusive" : "exclusive",
    payoutFixedBasis: (versionData?.payoutFixedTaxBasis ?? course.payout_fixed_tax_basis ?? legacyPayoutBasis) === "inclusive" ? "inclusive" : "exclusive",
  } as const;
}

/** 承認時点の適用単価を日報へ固定する。以後の単価マスタ変更で過去集計を動かさない。 */
export async function captureReportRateSnapshots(
  supabase: SupabaseClient,
  orgId: string,
  reportIds: string[],
): Promise<void> {
  if (reportIds.length === 0) return;

  const { data: reports, error: reportError } = await supabase
    .from("daily_reports_v2")
    .select("id, report_date, course_id, cycle_no")
    .eq("org_id", orgId)
    .in("id", reportIds);
  if (reportError) throw reportError;

  const courseIds = Array.from(new Set((reports ?? []).map((r) => r.course_id).filter(Boolean)));
  const [{ data: courses }, { data: unitRates }, { data: fixedRates }, { data: fixedBundles }, { data: entries }, { data: versions }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, revenue_tax_basis, payout_tax_basis, revenue_piece_tax_basis, payout_piece_tax_basis, revenue_fixed_tax_basis, payout_fixed_tax_basis, revenue_rate_mode, payout_rate_mode")
      .eq("org_id", orgId)
      .in("id", courseIds),
    supabase
      .from("course_unit_rates")
      .select("course_id, cycle_no, unit_id, revenue_per_unit, payout_per_unit, revenue_contract_amount, payout_contract_amount, revenue_quantity_rule, payout_quantity_rule")
      .in("course_id", courseIds),
    supabase
      .from("course_fixed_rates")
      .select("course_id, cycle_no, fixed_revenue, fixed_payout, revenue_contract_amount, payout_contract_amount")
      .in("course_id", courseIds),
    supabase
      .from("course_fixed_rate_bundles")
      .select("course_id, required_cycle_nos, fixed_revenue, fixed_payout")
      .in("course_id", courseIds),
    supabase
      .from("report_entries")
      .select("report_id, unit_id, field_key, value_num")
      .in("report_id", reportIds),
    supabase
      .from("course_rate_versions")
      .select("course_id, effective_from, rate_data")
      .eq("org_id", orgId)
      .in("course_id", courseIds)
      .order("effective_from", { ascending: false }),
  ]);

  const unitIds = Array.from(new Set((entries ?? []).map((e) => e.unit_id).filter(Boolean)));
  const { data: fields } = unitIds.length
    ? await supabase.from("unit_fields").select("unit_id, field_key, is_billable").in("unit_id", unitIds)
    : { data: [] as any[] };
  const billable = new Set(
    (fields ?? []).filter((f) => f.is_billable).map((f) => `${f.unit_id}:${f.field_key}`),
  );
  const courseById = new Map((courses ?? []).map((c) => [c.id, c]));
  const entriesByReport = new Map<string, typeof entries>();
  for (const entry of entries ?? []) {
    const list = entriesByReport.get(entry.report_id) ?? [];
    list.push(entry);
    entriesByReport.set(entry.report_id, list);
  }
  const capturedAt = new Date().toISOString();

  for (const report of reports ?? []) {
    const course = courseById.get(report.course_id);
    if (!course) continue;
    const cycleNo = n(report.cycle_no);
    const version = selectEffectiveRateVersion(versions ?? [], report.course_id, String(report.report_date));
    const versionData = version?.rate_data && typeof version.rate_data === "object"
      ? version.rate_data as Record<string, unknown>
      : null;
    const versionUnitRates = Array.isArray(versionData?.unitRates) ? versionData.unitRates as any[] : null;
    const versionFixedRates = Array.isArray(versionData?.fixedRates) ? versionData.fixedRates as any[] : null;
    const activeUnitRates = versionUnitRates ?? unitRates ?? [];
    const activeFixedRates = versionFixedRates ?? fixedRates ?? [];
    const { revenuePieceBasis, payoutPieceBasis, revenueFixedBasis, payoutFixedBasis } = resolveCategoryTaxBases(versionData, course);
    const revenueRateMode = String(versionData?.revenueRateMode ?? course.revenue_rate_mode ?? "BOTH");
    const payoutRateMode = String(versionData?.payoutRateMode ?? course.payout_rate_mode ?? "BOTH");
    const revenueUsesPiece = revenueRateMode === "PER_PIECE" || revenueRateMode === "BOTH";
    const payoutUsesPiece = payoutRateMode === "PER_PIECE" || payoutRateMode === "BOTH";
    const revenueUsesFixed = revenueRateMode === "FIXED" || revenueRateMode === "BOTH";
    const payoutUsesFixed = payoutRateMode === "FIXED" || payoutRateMode === "BOTH";
    const components: ReportRateSnapshotComponent[] = [];

    for (const entry of entriesByReport.get(report.id) ?? []) {
      if (!billable.has(`${entry.unit_id}:${entry.field_key}`)) continue;
      const rate = activeUnitRates.find((r) =>
        (r.course_id == null || r.course_id === report.course_id) && r.unit_id === entry.unit_id && n(r.cycle_no) === cycleNo,
      ) ?? activeUnitRates.find((r) =>
        (r.course_id == null || r.course_id === report.course_id) && r.unit_id === entry.unit_id && n(r.cycle_no) === 0,
      );
      const actualQuantity = Number(entry.value_num) || 0;
      if (!rate || actualQuantity === 0) continue;
      const revenueQuantity = applyQuantityRule(actualQuantity, rate.revenue_quantity_rule);
      const payoutQuantity = applyQuantityRule(actualQuantity, rate.payout_quantity_rule);
      const revenueContractAmount = price(rate.revenue_contract_amount ?? rate.revenue_per_unit);
      const payoutContractAmount = price(rate.payout_contract_amount ?? rate.payout_per_unit);
      const revenue = revenueUsesPiece
        ? exclusiveContractTotal(revenueContractAmount, revenueQuantity, revenuePieceBasis)
        : 0;
      const payout = payoutUsesPiece
        ? exclusiveContractTotal(payoutContractAmount, payoutQuantity, payoutPieceBasis)
        : 0;
      if (revenue === 0 && payout === 0) continue;
      components.push({
        kind: "unit",
        unitId: entry.unit_id,
        // 既存表示との互換上 quantity は売上側の計算数量。実績値は別に保持する。
        quantity: revenueQuantity,
        actualQuantity,
        revenueContractAmount,
        revenueBasis: revenuePieceBasis,
        payoutContractAmount,
        payoutBasis: payoutPieceBasis,
        revenue,
        payout,
        profit: revenue - payout,
      });
    }

    const fixed = activeFixedRates.find((r) =>
      (r.course_id == null || r.course_id === report.course_id) && n(r.cycle_no) === cycleNo,
    ) ?? activeFixedRates.find((r) =>
      (r.course_id == null || r.course_id === report.course_id) && n(r.cycle_no) === 0,
    );
    if (fixed && (price(fixed.fixed_revenue) !== 0 || price(fixed.fixed_payout) !== 0)) {
      const revenueContractAmount = price(fixed.revenue_contract_amount ?? fixed.fixed_revenue);
      const payoutContractAmount = price(fixed.payout_contract_amount ?? fixed.fixed_payout);
      const revenue = revenueUsesFixed
        ? exclusiveContractTotal(revenueContractAmount, 1, revenueFixedBasis)
        : 0;
      const payout = payoutUsesFixed
        ? exclusiveContractTotal(payoutContractAmount, 1, payoutFixedBasis)
        : 0;
      if (revenue !== 0 || payout !== 0) components.push({
        kind: "fixed",
        unitId: null,
        quantity: 1,
        revenueContractAmount,
        revenueBasis: revenueFixedBasis,
        payoutContractAmount,
        payoutBasis: payoutFixedBasis,
        revenue,
        payout,
        profit: revenue - payout,
      });
    }

    const versionBundle = versionData?.fixedBundle as any;
    const currentBundle = (fixedBundles ?? []).find((bundle: any) => bundle.course_id === report.course_id);
    const bundle = versionBundle ? {
      requiredCycleNos: Array.isArray(versionBundle.required_cycle_nos) ? versionBundle.required_cycle_nos.map(Number) : [],
      fixedRevenue: versionBundle.revenue_contract_amount == null ? null
        : exclusiveUnitPriceOf(price(versionBundle.revenue_contract_amount), revenueFixedBasis),
      fixedPayout: versionBundle.payout_contract_amount == null ? null
        : exclusiveUnitPriceOf(price(versionBundle.payout_contract_amount), payoutFixedBasis),
    } : currentBundle ? {
      requiredCycleNos: Array.isArray(currentBundle.required_cycle_nos) ? currentBundle.required_cycle_nos.map(Number) : [],
      fixedRevenue: currentBundle.fixed_revenue == null ? null : price(currentBundle.fixed_revenue),
      fixedPayout: currentBundle.fixed_payout == null ? null : price(currentBundle.fixed_payout),
    } : undefined;
    const snapshot: ReportRateSnapshot = { version: 1, capturedAt, components, fixedBundle: bundle };
    const { error } = await supabase
      .from("daily_reports_v2")
      .update({ rate_snapshot: snapshot })
      .eq("id", report.id)
      .eq("org_id", orgId);
    if (error) throw error;
  }
}
