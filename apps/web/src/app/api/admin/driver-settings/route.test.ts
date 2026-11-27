// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), caps: new Set<string>() }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => mock.caps.has("can_view_members") ? { orgId: "own" } : NextResponse.json({}, { status: 403 }),
  isAuthError: (value: unknown) => value instanceof NextResponse,
}));
vi.mock("@/server/auth/permissions", () => ({ hasCapabilityCached: async (_: unknown, cap: string) => mock.caps.has(cap) }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: mock.rpc } }));
import { GET, PATCH } from "./route";
const id = "00000000-0000-4000-8000-000000000012";
const url = "http://localhost/api/admin/driver-settings";
const patch = (field: string, value: unknown, expected: unknown) => PATCH(new NextRequest(url, { method: "PATCH",
  body: JSON.stringify({ orgId: "other", driverId: id, field, value, expected }) }));
beforeEach(() => {
  mock.rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  mock.caps = new Set(["can_view_members"]);
});
it("閲覧権限に応じて契約・車両をDBで絞る", async () => {
  await GET(new NextRequest(url));
  expect(mock.rpc).toHaveBeenCalledWith("driver_settings_overview", { p_org: "own", p_leases: false, p_vehicles: false });
});
it("本人の組織でのみ提出要否を変更し、車両編集と権限を分ける", async () => {
  expect((await patch("photo",true,false)).status).toBe(400);
  expect((await patch("parking",true,false)).status).toBe(403);
  mock.caps.add("can_manage_members");
  expect((await patch("parking",true,false)).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("set_driver_parking_requirement", { p_org: "own", p_driver: id, p_value: true, p_expected: false });
  expect((await patch("vehicles",[id],[])).status).toBe(403);
  mock.caps.add("can_manage_vehicles");
  expect((await patch("vehicles",["invalid"],[])).status).toBe(400);
  expect((await patch("vehicles",[id],[])).status).toBe(200);
});
