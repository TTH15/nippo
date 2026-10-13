// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ from: vi.fn(), data: {} as any, auto: [] as any[], filters: [] as unknown[][] }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({ requirePermission: async () => ({ driverId: "actor" }), isAuthError: () => false }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "own" }));
vi.mock("@/server/aggregation/load", () => ({ loadAggregationData: async () => m.data }));
vi.mock("@/server/aggregation/compute", () => ({
  buildContext: () => ({}), buildContributions: () => m.auto,
  sumBy: (rows: any[]) => new Map(rows.map(r => [r.driverId, { payout: r.payout }])),
  isCountableReport: (r: any) => !r.rejectedAt,
}));
vi.mock("@/server/billing/driverLease", () => ({ loadDriverLeases: async () => new Map(), loadCourseDailyLease: async () => new Map(), computeLeaseDeduction: () => 0 }));
import { GET } from "./route";
beforeEach(() => { m.filters.length = 0; m.auto = []; m.data = { carriers: [], reports: [], courseBillingMeta: [{ courseId: "own-c" }] }; });
it("終了者・シフト0の在籍者・移行/再稼働前実績・相殺金額行を保持し他社/新規を除く", async () => {
  const driver = (id: string, extra: object = {}) => ({ id, name: id, org_id: "own", works_as_driver: true, status: "active", created_at: "2025-01-01T00:00:00Z", ...extra });
  const tables: Record<string, any[]> = {
    drivers: [driver("ended", { status: "inactive", active_until_month: "2026-08" }), driver("no-shifts"),
      driver("new", { created_at: "2026-09-01T00:00:00Z" }), driver("foreign", { org_id: "other" }),
      driver("migrated", { created_at: "2026-09-01T00:00:00Z" }), driver("restart", { active_from_month: "2026-09" }),
      driver("old-end", { active_until_month: "2026-07" }), driver("adjustment", { active_until_month: "2026-07" }),
      driver("offset", { active_until_month: "2026-07" }), driver("income", { active_until_month: "2026-07" }), driver("pending", { status: "pending" })],
    shifts: [{ id: "s1", course_id: "own-c", driver_id: "migrated", shift_date: "2026-08-15" },
      { id: "s2", course_id: "foreign-c", driver_id: "new", shift_date: "2026-08-15" },
      { id: "s3", course_id: "own-c", driver_id: "foreign", shift_date: "2026-08-15" }],
    driver_fixed_expenses: [{ driver_id: "adjustment", amount: 4000 }, { driver_id: "offset", amount: 1000 }, { driver_id: "offset", amount: -1000 }],
    driver_ad_hoc_expenses: [{ driver_id: "adjustment", amount: -6000 }],
  };
  m.data.reports = [{ driverId: "restart", reportDate: "2026-08-16", courseId: "own-c" }];
  m.auto = [{ driverId: "income", payout: 9000 }];
  m.from.mockImplementation((table: string) => {
    let data = tables[table] ?? [];
    const q: any = { then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve) };
    for (const op of ["select", "eq", "in", "gte", "lte", "or", "order", "range"]) q[op] = (...args: any[]) => {
      m.filters.push([table, op, ...args]);
      if (op === "eq" && ["org_id", "works_as_driver"].includes(args[0])) data = data.filter(r => r[args[0]] === args[1]);
      if (op === "in") data = data.filter(r => args[1].includes(r[args[0]]));
      return q;
    };
    return q;
  });
  const response = await GET(new NextRequest("http://localhost/api/admin/payments?month=2026-08"));
  expect(response.status).toBe(200);
  const { rows } = await response.json();
  expect(rows.map((r: any) => r.driverId)).toEqual(["ended", "no-shifts", "migrated", "restart", "adjustment", "offset", "income"]);
  expect(rows.find((r: any) => r.driverId === "adjustment")).toMatchObject({ incomeLog: 0, fixedDeductions: 4000, adHocDeductions: -6000, net: 2000, outsideActivePeriod: true });
  expect(rows.find((r: any) => r.driverId === "offset")).toMatchObject({ net: 0, outsideActivePeriod: true });
  expect(rows.find((r: any) => r.driverId === "income")).toMatchObject({ incomeLog: 9000, net: 9000, outsideActivePeriod: true });
  expect(m.filters).toContainEqual(["drivers", "eq", "org_id", "own"]);
  expect(m.filters).toContainEqual(["shifts", "in", "course_id", ["own-c"]]);
});
