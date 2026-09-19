// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const h = vi.hoisted(() => ({ rpc: vi.fn(), permission: vi.fn() }));
vi.mock("@/server/auth", () => ({ requirePermission: h.permission, isAuthError: (u: unknown) => u instanceof Response }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
import { POST } from "./route";
const uuid = "00000000-0000-4000-8000-000000000001";
const input = { action: "preview", mode: "add", groups: [{ date: "2026-09-16", courseId: uuid, cycleNo: 1, driverIds: [uuid] }] };
const req = (body: unknown) => new NextRequest("http://localhost/api/admin/shifts/memo/reflect", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: { added: 1 }, error: null }); h.permission.mockReset().mockResolvedValue({ driverId: "actor", orgId: "org" }); });
it("確認・確定ともシフト管理権限が必須", async () => {
  h.permission.mockResolvedValue(new Response(null, { status: 403 }));
  for (const action of ["preview", "apply"]) expect((await POST(req({ ...input, action }))).status).toBe(403);
  expect(h.rpc).not.toHaveBeenCalled();
  expect(h.permission.mock.calls[0][1]).toBe("can_manage_shifts");
});
it("会社と実行者は本文で上書きできない。確認時はrevisionを渡さない", async () => {
  expect((await POST(req({ ...input, orgId: "other", actorId: "other", revision: "bad" }))).status).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith("reflect_shift_memo", expect.objectContaining({ p_org_id: "org", p_actor_id: "actor", p_revision: null }));
});
it("壊れた入力・架空日・重複・確認なしの確定をDBへ送らない", async () => {
  for (const body of [null, {}, { ...input, action: "apply" }, { ...input, mode: "anything" }, { ...input, groups: [{ ...input.groups[0], date: "2026-02-30" }] }, { ...input, groups: [input.groups[0], input.groups[0]] }, { ...input, groups: [{ ...input.groups[0], driverIds: [uuid, uuid] }] }, { ...input, groups: [{ ...input.groups[0], cycleNo: "1" }] }]) expect((await POST(req(body))).status).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();
});
it("競合時は409、他社/無効な対象は404、DB更新前は503", async () => {
  for (const [code, status] of [["40001", 409], ["P0002", 404], ["PGRST202", 503]] as const) {
    h.rpc.mockResolvedValue({ error: { code } });
    expect((await POST(req({ ...input, action: "apply", revision: "a".repeat(32) }))).status).toBe(status);
  }
});
