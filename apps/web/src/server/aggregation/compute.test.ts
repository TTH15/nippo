import { describe, expect, it } from "vitest";
import { buildContext, reportContributions } from "./compute";
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
});

describe("数量条件付き従量単価", () => {
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
