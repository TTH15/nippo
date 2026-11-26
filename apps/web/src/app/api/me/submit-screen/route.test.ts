// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AggregationData } from "@/server/aggregation/load";
import type { DailyReport } from "@/server/aggregation/types";
import type { DriverLease } from "@/server/billing/driverLease";

const mock = vi.hoisted(() => ({
  from: vi.fn(), load: vi.fn(), lease: null as DriverLease, dailyLease: new Map<string, number>(),
  denied: false, pending: { data: [] as ReturnType<typeof pendingCourse>[], error: null as object | null }, filters: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  requireAuth: async () => mock.denied ? NextResponse.json({}, { status: 401 }) : { driverId: "self" },
  isAuthError: (value: unknown) => value instanceof NextResponse,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "own-org" }));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/server/aggregation/load", () => ({ loadAggregationData: mock.load }));
vi.mock("@/server/submitScreen/config", () => ({
  loadSubmitScreenConfig: async () => ({ blocks: [{ id: "reward", type: "today_reward", enabled: true }] }),
}));
vi.mock("@/server/billing/driverLease", async (loadOriginal) => ({
  ...await loadOriginal<typeof import("@/server/billing/driverLease")>(),
  loadDriverLease: async () => mock.lease,
  loadCourseDailyLease: async () => mock.dailyLease,
}));

import { GET } from "./route";
import { computeDriverAutoPayout } from "@/server/billing/driverPayout";

const date = "2026-11-20";
const req = () => new NextRequest(`http://localhost/api/me/submit-screen?date=${date}&driverId=other&orgId=other`);
const report = (courseId: string, cycleNo = 0, extra: Partial<DailyReport> = {}): DailyReport => ({
  id: `${courseId}:${cycleNo}`, reportDate: date, driverId: "self", courseId, cycleNo,
  carrierId: null, approvedAt: null, rejectedAt: null, entries: [], ...extra,
});
function pendingCourse(courseId: string, cycleNo = 0) {
  return { id: `request-${courseId}-${cycleNo}`, course_id: courseId, cycle_no: cycleNo,
    entries: [{ unitId: "parcel", fieldKey: "delivered", valueNum: 4 }] };
}
const fixed = (courseId: string, fixedPayout: number, cycleNo = 0) => (
  { courseId, cycleNo, fixedRevenue: 0, fixedProfit: 0, fixedPayout }
);
const data = (extra: Partial<AggregationData> = {}): AggregationData => ({
  carriers: [], units: [], courseBillingMeta: [], unitRates: [], fixedRates: [],
  fixedRateBundles: [], reports: [], ledger: [], ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.denied = false;
  mock.lease = null;
  mock.dailyLease = new Map();
  mock.pending = { data: [], error: null };
  mock.load.mockResolvedValue(data());
  mock.from.mockImplementation((table: string) => {
    const result = table === "report_course_requests" ? mock.pending : { data: [] };
    const query = {
      order: () => query, range: () => query, overrideTypes: () => query,
      eq: (...args: unknown[]) => { if (table === "report_course_requests") mock.filters(...args); return query; },
      then: (onResolve: (value: typeof result) => unknown) => Promise.resolve(result).then(onResolve),
    };
    return { select: () => query };
  });
});

it("本人・当日の通常日報は未承認でも見込みに含め、複数コースの日額リースは最大額を1回だけ控除する", async () => {
  mock.lease = { mode: "DAILY", amount: 0 };
  mock.dailyLease = new Map([["a", 2_000], ["b", 3_000], ["rejected", 9_000], ["foreign", 12_000]]);
  mock.load.mockResolvedValue(data({
    reports: [report("a"), report("b", 0, { approvedAt: date }), report("rejected", 0, { rejectedAt: date }),
      report("foreign", 0, { driverId: "other" }), report("foreign", 0, { reportDate: "2026-11-19" })],
    fixedRates: [fixed("a", 5_000), fixed("b", 8_000), fixed("rejected", 50_000), fixed("foreign", 80_000), fixed("request", 70_000)],
  }));
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ todayReward: 11_300, blocks: [{
    type: "today_reward", todayReward: 11_300,
    breakdown: { beforeLease: 14_300, dailyLease: 3_000, monthlyLease: false, includedPendingCourseCount: 0 },
  }] });
  expect(mock.load).toHaveBeenCalledWith(expect.anything(), "own-org", date, date, { driverId: "self", withLedger: false });
  expect(mock.from.mock.calls).toEqual([["report_course_requests"]]);
  expect(mock.filters.mock.calls).toEqual([["org_id", "own-org"], ["driver_id", "self"], ["report_date", date], ["status", "pending"]]);
});

it("追加申請の取得失敗時は不完全な見込み額を返さない", async () => {
  mock.pending.error = { code: "failure" };
  const result = await GET(req());
  expect(result.status).toBe(503);
  expect(await result.json()).not.toHaveProperty("todayReward");
});

it("月額リースは日割りせず、承認前の追加だけでも日当と従量分を見込む", async () => {
  mock.lease = { mode: "MONTHLY", amount: 43_000 };
  mock.pending.data = [pendingCourse("a", 2)];
  mock.load.mockResolvedValue(data({
    units: [{ id: "parcel", carrierId: "carrier", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "delivered", isBillable: true }] }],
    unitRates: [{ courseId: "a", cycleNo: 2, unitId: "parcel", payoutPerUnit: 100, revenuePerUnit: 120, profitPerUnit: 20 }],
    fixedRates: [fixed("a", 5_000, 2)],
  }));
  expect(await (await GET(req())).json()).toMatchObject({ todayReward: 5_940, blocks: [{
    breakdown: { beforeLease: 5_940, dailyLease: 0, monthlyLease: true, includedPendingCourseCount: 1 },
  }] });
});

it("承認と同時に読んだ同一コース・便は正式な日報だけで計算する", async () => {
  mock.pending.data = [pendingCourse("a"), pendingCourse("b")];
  mock.lease = { mode: "DAILY", amount: 0 };
  mock.dailyLease = new Map([["a", 2000], ["b", 3000]]);
  mock.load.mockResolvedValue(data({ reports: [report("a")], fixedRates: [fixed("a", 5000), fixed("b", 8000)] }));
  expect(await (await GET(req())).json()).toMatchObject({ todayReward: 11_300, blocks: [{
    breakdown: { beforeLease: 14_300, dailyLease: 3000, includedPendingCourseCount: 1 },
  }] });
});

it("2便揃うとPWA見込みは全日単価に置換し、現行の月次経路とは異なる場合がある", async () => {
  mock.pending.data = [pendingCourse("bundle", 2)];
  const bundleData = data({
    reports: [report("bundle", 1, { approvedAt: date })],
    fixedRates: [fixed("bundle", 7_000, 1), fixed("bundle", 7_000, 2)],
    fixedRateBundles: [{ courseId: "bundle", requiredCycleNos: [1, 2], fixedRevenue: null, fixedPayout: 15_000 }],
  });
  mock.load.mockResolvedValue(bundleData);
  expect(await (await GET(req())).json()).toMatchObject({ todayReward: 16_500, blocks: [{
    breakdown: { beforeLease: 16_500, dailyLease: 0, includedPendingCourseCount: 1 },
  }] });
  mock.pending.data = [];
  mock.load.mockResolvedValue({ ...bundleData, reports: [...bundleData.reports, report("bundle", 2, { approvedAt: date })] });
  expect(await (await GET(req())).json()).toMatchObject({ todayReward: 16_500, blocks: [{
    breakdown: { includedPendingCourseCount: 0 },
  }] });
  // 調査上の比較。月次・会計・native の共有計算はこの修正では置換しない。
  const monthly = await computeDriverAutoPayout({ from: mock.from } as unknown as SupabaseClient,
    "own-org", "self", "2026-11-01", "2026-11-30", { taxInclusive: true });
  expect(monthly.total).toBe(15_400);
});

it("未認証で報酬や承認待ちの集計を読まない", async () => {
  mock.denied = true;
  expect((await GET(req())).status).toBe(401);
  expect(mock.load).not.toHaveBeenCalled();
  expect(mock.from).not.toHaveBeenCalled();
});
