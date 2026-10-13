import { exclusiveOf, inclusiveOf, roundUnitPrice } from "@repo/core/logic/taxBasis";
import { dropSupersededLegacyReports, isCountableReport } from "../aggregation/compute";
import type { CourseFixedRate, CourseFixedRateBundle, DailyReport, RateMode, TaxBasis } from "../aggregation/types";

type FixedDays = Map<string, Map<string, number>>;
type Options = {
  reports: DailyReport[];
  allowedCourseIds: Set<string>;
  fixedRates: Map<string, CourseFixedRate>;
  bundles: Map<string, CourseFixedRateBundle>;
  revenueModes: Map<string, RateMode>;
  revenueBases: Map<string, TaxBasis>;
  /** 月次の手動統合で参照されている固定行は元キー・数量を維持する。 */
  preservedLineKeys?: ReadonlySet<string>;
};

/** 請求明細だけの集約。日報の保存スナップショット・内部売上には触れない。 */
export function countFixedBillingDays(options: Options): FixedDays {
  const { fixedRates, bundles, revenueBases } = options;
  const days: FixedDays = new Map();
  const reportDays = new Map<string, { courseId: string; driverId: string; counts: Map<number, number> }>();
  const add = (key: string, driverId: string, amount = 1) => {
    const byDriver = days.get(key) ?? new Map<string, number>();
    byDriver.set(driverId, (byDriver.get(driverId) ?? 0) + amount);
    days.set(key, byDriver);
  };
  const priceOf = (courseId: string, cycle: number | "bundle") => {
    const rate = cycle === "bundle" ? bundles.get(courseId) : fixedRates.get(`${courseId}:${cycle}`);
    const contract = rate?.revenueContractAmount;
    return {
      price: contract ?? rate?.fixedRevenue ?? 0,
      basis: contract != null ? revenueBases.get(courseId) ?? "exclusive" : "exclusive",
    };
  };

  for (const report of dropSupersededLegacyReports(options.reports)) {
    const courseId = report.courseId;
    const mode = courseId ? options.revenueModes.get(courseId) ?? "BOTH" : "NONE";
    if (!courseId || !options.allowedCourseIds.has(courseId) || !isCountableReport(report) ||
        (mode !== "FIXED" && mode !== "BOTH")) continue;
    const cycle = report.cycleNo ?? 0;
    const exactKey = `${courseId}:${cycle}`;
    const rateKey = fixedRates.has(exactKey) ? exactKey : `${courseId}:0`;
    const rate = fixedRates.get(rateKey);
    if (rate && rate.fixedRevenue !== 0) {
      add(rateKey, report.driverId);
      // cycle0へのフォールバックは便別単価ではないため、全日への置換候補にしない。
      if (cycle > 0 && rateKey === exactKey) {
        const key = `${report.reportDate}:${courseId}:${report.driverId}`;
        const day = reportDays.get(key) ?? { courseId, driverId: report.driverId, counts: new Map<number, number>() };
        day.counts.set(cycle, (day.counts.get(cycle) ?? 0) + 1);
        reportDays.set(key, day);
      }
    } else if (cycle === 0) {
      const bundle = bundles.get(courseId);
      if (bundle && (bundle.revenueContractAmount != null || bundle.fixedRevenue != null)) {
        add(`${courseId}:bundle`, report.driverId);
      }
    }
  }

  const pairs = new Map<string, { courseId: string; driverId: string; count: number }>();
  for (const day of reportDays.values()) {
    const bundle = bundles.get(day.courseId);
    // 統合元は月次行を丸ごと指す。片側だけの統合や既存全日行も含め、
    // 新しい全日行へ振り替えると抑制から漏れる／余分に抑制されるため便別を維持する。
    if ([1, 2, "bundle"].some((cycle) => options.preservedLineKeys?.has(
      `fx:${day.courseId}:cycle:${cycle}:drv:${day.driverId}`,
    ))) continue;
    // 今回の対象はC1+C2。別の便構成の契約は従来の明細を維持する。
    if (!bundle || bundle.requiredCycleNos.length !== 2 ||
        !bundle.requiredCycleNos.includes(1) || !bundle.requiredCycleNos.includes(2)) continue;
    const count = Math.min(day.counts.get(1) ?? 0, day.counts.get(2) ?? 0);
    if (!count) continue;
    const first = priceOf(day.courseId, 1);
    const second = priceOf(day.courseId, 2);
    const full = priceOf(day.courseId, "bundle");
    if (first.basis !== second.basis || first.basis !== full.basis || !full.price ||
        roundUnitPrice(first.price + second.price) !== roundUnitPrice(full.price)) continue;
    const key = `${day.courseId}:${day.driverId}`;
    const pair = pairs.get(key) ?? { courseId: day.courseId, driverId: day.driverId, count: 0 };
    pair.count += count;
    pairs.set(key, pair);
  }

  for (const { courseId, driverId, count } of pairs.values()) {
    const cycles = [1, 2, "bundle"] as const;
    const before = cycles.map((cycle) => days.get(`${courseId}:${cycle}`)?.get(driverId) ?? 0);
    const after = [before[0] - count, before[1] - count, before[2] + count];
    const prices = cycles.map((cycle) => priceOf(courseId, cycle));
    // 月次行での丸め・表示基準の換算まで含め、集約前後の請求額を維持する。
    const total = (counts: number[], display: TaxBasis | "raw") => counts.reduce((sum, qty, i) => {
      const { price, basis } = prices[i];
      const shown = display === "raw" ? price : display === "inclusive" ? inclusiveOf(price, basis) : exclusiveOf(price, basis);
      return sum + Math.round(qty * shown);
    }, 0);
    if ((["raw", "exclusive", "inclusive"] as const).some((basis) => total(before, basis) !== total(after, basis))) continue;
    add(`${courseId}:1`, driverId, -count);
    add(`${courseId}:2`, driverId, -count);
    add(`${courseId}:bundle`, driverId, count);
  }
  return days;
}
