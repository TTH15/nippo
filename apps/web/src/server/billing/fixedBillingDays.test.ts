import { describe, expect, it } from "vitest";
import { countFixedBillingDays } from "./fixedBillingDays";
import type { CourseFixedRate, CourseFixedRateBundle, DailyReport, RateMode, TaxBasis } from "../aggregation/types";

let reportSequence = 0;
const report = (cycleNo: number, overrides: Partial<DailyReport> = {}): DailyReport => ({
  id: `report-${++reportSequence}`, reportDate: "2026-08-30", courseId: "course", driverId: "driver",
  cycleNo, carrierId: "carrier", approvedAt: "2026-08-31", rejectedAt: null, entries: [], ...overrides,
});
const rate = (cycleNo: number, price = 8500): CourseFixedRate => ({
  courseId: "course", cycleNo, fixedRevenue: 7727, fixedProfit: 1818, fixedPayout: 5909, revenueContractAmount: price,
});
const bundle: CourseFixedRateBundle = { courseId: "course", requiredCycleNos: [1, 2], fixedRevenue: 15454, fixedPayout: 11818, revenueContractAmount: 17000 };
function options(reports: DailyReport[]) {
  return {
    reports, allowedCourseIds: new Set(["course"]),
    fixedRates: new Map([["course:1", rate(1)], ["course:2", rate(2)]]),
    bundles: new Map([["course", bundle]]),
    revenueModes: new Map<string, RateMode>([["course", "FIXED"]]),
    revenueBases: new Map<string, TaxBasis>([["course", "inclusive"]]),
  };
}
const quantity = (days: ReturnType<typeof countFixedBillingDays>, cycle: number | "bundle", driver = "driver") => days.get(`course:${cycle}`)?.get(driver) ?? 0;

describe("取引先請求の全日・片便の集約", () => {
  it("同人・同コース・同日C1+C2は全日1日、片便だけの日は独立して残す", () => {
    const days = countFixedBillingDays(options([report(1), report(2), report(1, { reportDate: "2026-08-31" })]));
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([1, 1, 0]);
  });
  it("別日のC1とC2を月単位で結合しない", () => {
    const days = countFixedBillingDays(options([report(1), report(2, { reportDate: "2026-08-31" })]));
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 1]);
  });
  it("別人の分担は結合しない", () => {
    const days = countFixedBillingDays(options([report(1), report(2, { driverId: "other" })]));
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2, "other")]).toEqual([0, 1, 1]);
  });
  it("別コースのC2で全日を作らず、許可コース外の日報も集計しない", () => {
    const days = countFixedBillingDays(options([report(1), report(2, { courseId: "foreign-company-course" })]));
    expect([quantity(days, "bundle"), quantity(days, 1)]).toEqual([0, 1]);
    expect([...days.keys()]).toEqual(["course:1"]);
  });
  it("旧cycle0と新便別日報が共存しても同人・同日の二重計上を避ける", () => {
    const days = countFixedBillingDays(options([report(0), report(1), report(2), report(0, { reportDate: "2026-08-29" })]));
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([2, 0, 0]);
  });
  it("同日に余る片便は消さない", () => {
    const days = countFixedBillingDays(options([report(1), report(1), report(2)]));
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([1, 1, 0]);
  });
  it("全日を働く人に加え別人の余った1便があっても両方を残す", () => {
    const days = countFixedBillingDays(options([report(1), report(2), report(1, { driverId: "extra-driver" })]));
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 1, "extra-driver")]).toEqual([1, 0, 1]);
  });
  it("未承認・却下されたC2で全日を作らない", () => {
    for (const invalid of [{ approvedAt: null }, { rejectedAt: "2026-08-31" }]) {
      const days = countFixedBillingDays(options([report(1), report(2, invalid)]));
      expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 0]);
    }
  });
  it("税区分が異なる組を全日単価へ置換しない", () => {
    const input = options([report(1), report(2)]);
    input.fixedRates.set("course:1", { ...rate(1), fixedRevenue: 8500, revenueContractAmount: undefined });
    const days = countFixedBillingDays(input);
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 1]);
  });
  it("全日単価が便単価の合計と異なる場合は従来金額を維持する", () => {
    const input = options([report(1), report(2)]);
    input.bundles.set("course", { ...bundle, revenueContractAmount: 18000 });
    const days = countFixedBillingDays(input);
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 1]);
  });
  it("税抜表示の丸めで金額が変わる場合も結合しない", () => {
    const input = options([report(1), report(2)]);
    input.fixedRates.set("course:2", rate(2, 9000));
    input.bundles.set("course", { ...bundle, revenueContractAmount: 17500 });
    const days = countFixedBillingDays(input);
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 1]);
  });
  it("手動統合元のC1・C2・既存全日があれば月次の元キーを保持する", () => {
    for (const cycle of [1, 2, "bundle"]) {
      const input = { ...options([report(1), report(2)]), preservedLineKeys: new Set([`fx:course:cycle:${cycle}:drv:driver`]) };
      const days = countFixedBillingDays(input);
      expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 1]);
    }
  });
  it("他のドライバーの手動統合では本人の全日化を妨げない", () => {
    const input = { ...options([report(1), report(2)]), preservedLineKeys: new Set(["fx:course:cycle:1:drv:other"]) };
    expect(quantity(countFixedBillingDays(input), "bundle")).toBe(1);
  });
  it("全日契約がなければ便別単価を維持する", () => {
    const input = options([report(1), report(2)]);
    input.bundles.clear();
    const days = countFixedBillingDays(input);
    expect([quantity(days, "bundle"), quantity(days, 1), quantity(days, 2)]).toEqual([0, 1, 1]);
  });
  it("固定売上なしのコースは集計しない", () => {
    const input = options([report(1), report(2)]);
    input.revenueModes.set("course", "PER_PIECE");
    expect(countFixedBillingDays(input).size).toBe(0);
  });
  it("入力日報・単価・スナップショットを書き換えない", () => {
    const input = options([report(1), report(2)]);
    const before = JSON.stringify(input.reports);
    countFixedBillingDays(input);
    expect(JSON.stringify(input.reports)).toBe(before);
    expect(input.fixedRates.get("course:1")).toEqual(rate(1));
  });
});
