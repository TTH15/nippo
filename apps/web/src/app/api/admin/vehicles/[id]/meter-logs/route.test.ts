// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ read: vi.fn(), denied: false }));
vi.mock("@/server/auth", () => ({ requirePermission: async () => mocks.denied ? new Response(null, { status: 403 }) : ({ driverId: "admin" }), isAuthError: (value: unknown) => value instanceof Response }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "own-org" }));
vi.mock("@/server/aggregation/legacyShape", () => ({ loadLegacyDailyRows: mocks.read }));
vi.mock("@/server/db/client", () => ({ supabase: { from() {
  const query: any = { select: () => query, eq: () => query, in: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "driver", name: "架空 太郎", display_name: null }, { id: "peer", name: "架空 花子", display_name: null }], error: null }).then(resolve) }; return query;
} } }));
import { GET } from "./route";
const request = () => new NextRequest("http://localhost/api/admin/vehicles/van/meter-logs?start=2026-10-01&end=2026-10-16");
const context = { params: Promise.resolve({ id: "van" }) };
const row = { id: "c1", driver_id: "driver", report_date: "2026-10-16", vehicle_id: "van", meter_value: 149063, submitted_at: "2026-10-16T19:00:00Z", rejected_at: null };
beforeEach(() => { mocks.denied = false; vi.clearAllMocks(); mocks.read.mockResolvedValue([row, { ...row, id: "c2" }]); });
it("C1/C2の同じメーターを1件にし、自社・対象車両の範囲を維持する", async () => {
  const response = await GET(request(), context), result = await response.json();
  expect(result.logs).toHaveLength(1); expect(result.logs[0].meter_value).toBe(149063);
  expect(mocks.read.mock.calls[0].slice(1)).toEqual(["own-org", { start: "2026-10-01", end: "2026-10-16", vehicleId: "van" }]);
});
it("却下分を除外し、同日の別の読取値と別利用者は残す", async () => {
  mocks.read.mockResolvedValue([row, { ...row, id: "c2" }, { ...row, id: "later", meter_value: 149100, submitted_at: "2026-10-16T20:00:00Z" }, { ...row, id: "peer", driver_id: "peer" }, { ...row, id: "removed", meter_value: 999999, rejected_at: "removed" }]);
  const result = await (await GET(request(), context)).json();
  expect(result.logs).toHaveLength(3);
  expect(result.logs.map((log: any) => log.meter_value)).toEqual([149063, 149063, 149100]);
  expect(result.logs[1].driver.id).toBe("peer");
});
it("権限がなければ日報も取得しない", async () => {
  mocks.denied = true; expect((await GET(request(), context)).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled();
});
