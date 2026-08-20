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
});
