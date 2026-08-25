import { describe, expect, it } from "vitest";
import { buildContext, buildContributions, reportContributions } from "./compute";
import type { CourseFixedRate, DailyReport } from "./types";

const report = (cycleNo: number): DailyReport => ({
  id: `r-${cycleNo}`,
  driverId: "d1",
  reportDate: "2026-08-21",
  courseId: "c1",
  cycleNo,
  carrierId: "carrier-1",
  approvedAt: "2026-08-21T00:00:00Z",
  rejectedAt: null,
  entries: [],
});

describe("便別固定単価", () => {
  it("便一致を優先し、未設定の便は全便共通へフォールバックする", () => {
    const fixedRates: CourseFixedRate[] = [
      { courseId: "c1", cycleNo: 0, fixedRevenue: 17_000, fixedProfit: 4_000, fixedPayout: 13_000 },
      { courseId: "c1", cycleNo: 1, fixedRevenue: 9_000, fixedProfit: 2_000, fixedPayout: 7_000 },
    ];
    const ctx = buildContext([], [], fixedRates);
    expect(reportContributions(report(1), ctx)[0].payout).toBe(7_000);
    expect(reportContributions(report(2), ctx)[0].payout).toBe(13_000);
  });

  it("承認時スナップショットを現在の単価より優先する", () => {
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 20_000, fixedProfit: 5_000, fixedPayout: 15_000 },
    ]);
    const approved = {
      ...report(1),
      rateSnapshot: {
        version: 1 as const,
        capturedAt: "2026-08-21T00:00:00Z",
        components: [{
          kind: "fixed" as const,
          unitId: null,
          quantity: 1,
          revenueContractAmount: 17_000,
          revenueBasis: "exclusive" as const,
          payoutContractAmount: 13_000,
          payoutBasis: "exclusive" as const,
          revenue: 17_000,
          payout: 13_000,
          profit: 4_000,
        }],
      },
    };
    expect(reportContributions(approved, ctx)[0]).toMatchObject({
      revenue: 17_000,
      payout: 13_000,
      profit: 4_000,
    });
  });

  it("全日単価は売上をコース単位、支払を同一ドライバー単位で便別合計から置き換える", () => {
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 10_000, fixedProfit: 3_000, fixedPayout: 7_000 },
      { courseId: "c1", cycleNo: 2, fixedRevenue: 10_000, fixedProfit: 3_000, fixedPayout: 7_000 },
    ], [{ courseId: "c1", requiredCycleNos: [1, 2], fixedRevenue: 22_000, fixedPayout: 15_000 }]);

    const contributions = buildContributions([report(1), report(2)], [], ctx);
    const total = contributions.reduce((sum, item) => ({
      revenue: sum.revenue + item.revenue,
      payout: sum.payout + item.payout,
      profit: sum.profit + item.profit,
    }), { revenue: 0, payout: 0, profit: 0 });
    expect(total).toEqual({ revenue: 22_000, payout: 15_000, profit: 7_000 });

    const splitDriver = { ...report(2), driverId: "d2" };
    const split = buildContributions([report(1), splitDriver], [], ctx);
    expect(split.reduce((sum, item) => sum + item.revenue, 0)).toBe(22_000);
    expect(split.reduce((sum, item) => sum + item.payout, 0)).toBe(14_000);
  });

  it("旧cycle_no=0日報の空スナップショットを全日単価で補完する", () => {
    const legacy = {
      ...report(0),
      rateSnapshot: {
        version: 1 as const,
        capturedAt: "2026-08-23T00:00:00Z",
        components: [],
        fixedBundle: {
          requiredCycleNos: [1, 2],
          fixedRevenue: 15_454,
          fixedPayout: 11_818,
        },
      },
    };
    const ctx = buildContext([], [], [], [{
      courseId: "c1",
      requiredCycleNos: [1, 2],
      fixedRevenue: 15_454,
      fixedPayout: 11_818,
    }]);

    expect(reportContributions(legacy, ctx)).toEqual([expect.objectContaining({
      source: "auto_fixed",
      revenue: 15_454,
      payout: 11_818,
      profit: 3_636,
    })]);
  });

  it("旧cycle_no=0日報が同一コースに複数あっても売上は1日分、報酬は人数分にする", () => {
    const snapshot = {
      version: 1 as const,
      capturedAt: "2026-08-23T00:00:00Z",
      components: [],
      fixedBundle: {
        requiredCycleNos: [1, 2],
        fixedRevenue: 15_454,
        fixedPayout: 11_818,
      },
    };
    const ctx = buildContext([], [], [], [{
      courseId: "c1",
      requiredCycleNos: [1, 2],
      fixedRevenue: 15_454,
      fixedPayout: 11_818,
    }]);
    const contributions = buildContributions([
      { ...report(0), id: "legacy-1", rateSnapshot: snapshot },
      { ...report(0), id: "legacy-2", driverId: "d2", rateSnapshot: snapshot },
    ], [], ctx);

    expect(contributions.reduce((sum, item) => sum + item.revenue, 0)).toBe(15_454);
    expect(contributions.reduce((sum, item) => sum + item.payout, 0)).toBe(23_636);
  });
});

describe("数量条件付き従量単価", () => {
  it("日当と歩合は加算する", () => {
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 100 }],
    };
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 0, payoutPerUnit: 150, profitPerUnit: -150 }],
      [{ courseId: "c1", cycleNo: 1, fixedRevenue: 0, fixedProfit: -6_500, fixedPayout: 6_500 }],
    );
    expect(reportContributions(withEntry, ctx).reduce((sum, item) => sum + item.payout, 0)).toBe(21_500);
  });

  it("売上だけ最低100個、支払は実数で計算できる", () => {
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 80 }],
    };
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{
        courseId: "c1", cycleNo: 1, unitId: "u1",
        revenuePerUnit: 180, payoutPerUnit: 150, profitPerUnit: 30,
        revenueQuantityRule: { kind: "minimum", minimum: 100, scope: "report" },
        payoutQuantityRule: { kind: "actual" },
      }],
      [],
    );
    expect(reportContributions(withEntry, ctx)[0]).toMatchObject({
      revenue: 18_000,
      payout: 12_000,
      profit: 6_000,
    });
  });
});
