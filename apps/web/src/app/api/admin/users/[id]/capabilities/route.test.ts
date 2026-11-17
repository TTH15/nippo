// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), capabilities: new Set(["can_manage_members", "can_view_sales"]), org: "org-a" }));
vi.mock("@/server/auth", () => ({
  CAPABILITIES: ["can_manage_members", "can_view_sales", "can_view_profit"],
  requirePermission: async () => ({ driverId: "actor", orgId: mock.org, capabilities: mock.capabilities }),
  isAuthError: (value: unknown) => value instanceof NextResponse,
}));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: mock.rpc } }));
import { PUT } from "./route";

const request = (capability: string, enabled = true) => new NextRequest("http://localhost/api/admin/users/target/capabilities", { method: "PUT", body: JSON.stringify({ capability, enabled }) });
const context = { params: Promise.resolve({ id: "target" }) };
beforeEach(() => { mock.rpc.mockReset().mockResolvedValue({ error: null }); mock.capabilities = new Set(["can_manage_members", "can_view_sales"]); });
it("自分の持つ権限だけを同じ所属内の対象に付与する", async () => {
  expect((await PUT(request("can_view_sales"), context)).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("set_member_capability_grant", { p_org: "org-a", p_actor: "actor", p_target: "target", p_capability: "can_view_sales", p_enabled: true });
});
it("利益は保持していても個人付与できず、未知権限も拒否する", async () => {
  mock.capabilities.add("can_view_profit");
  expect((await PUT(request("can_view_profit"), context)).status).toBe(400);
  expect((await PUT(request("not_a_capability"), context)).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("別の所属や無効な対象は見つからない応答にする", async () => {
  mock.rpc.mockResolvedValue({ error: { code: "P0002" } });
  expect((await PUT(request("can_view_sales"), context)).status).toBe(404);
});
