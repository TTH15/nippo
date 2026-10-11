// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/server/auth", () => ({ requirePermission: m.auth, isAuthError: (user: unknown) => user instanceof Response }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: () => "org-a" }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: m.rpc, from: m.from } }));
import { GET, PATCH } from "./route";
const changes = [{ field: "notes", key: "lane|2026-10-11", expected: null, value: "架空メモ" }];
const request = (body?: unknown) => new NextRequest("http://localhost/api/admin/shifts/memo/board?orgId=org-b", body === undefined ? undefined : { method: "PATCH", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); m.auth.mockResolvedValue({ orgId: "org-a", driverId: "actor-a" });
  m.rpc.mockResolvedValue({ data: { saved: true, revision: 1, board: {} }, error: null });
});
it("PATCH uses authenticated actor and organization", async () => {
  const response = await PATCH(request({ initialBoard: null, changes, orgId: "org-b", actorId: "actor-b" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(m.auth).toHaveBeenCalledWith(expect.anything(), "can_manage_shifts");
  expect(m.rpc).toHaveBeenCalledWith("save_shared_shift_memo_board", { p_org_id: "org-a", p_actor_id: "actor-a", p_initial_board: null, p_changes: changes });
});
it("GET only loads authenticated organization and prevents response caching", async () => {
  const eq = vi.fn(); const query: any = { select: () => query, eq: (...args: unknown[]) => { eq(...args); return query; }, maybeSingle: () => ({ data: { revision: 3, board: {} }, error: null }) };
  m.from.mockReturnValue(query); const response = await GET(request());
  expect(eq).toHaveBeenCalledWith("org_id", "org-a"); expect(m.auth).toHaveBeenCalledWith(expect.anything(), "can_view_shifts");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([401, 403])("denial %i never accesses DB", async status => {
  m.auth.mockResolvedValue(NextResponse.json({ error: "denied" }, { status }));
  expect((await GET(request())).status).toBe(status); expect((await PATCH(request({ initialBoard: null, changes }))).status).toBe(status);
  expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it("conflict never returns the unpersisted RPC board", async () => {
  m.rpc.mockResolvedValue({ data: { saved: false, revision: 5, board: { notes: "partial" } } });
  const response = await PATCH(request({ initialBoard: null, changes })); expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("board");
});
it.each([true, null])("accepts candidate hide/restore %s", async value => {
  expect((await PATCH(request({ initialBoard: null, changes: [{ field: "hiddenPeople", key: "driver:one", expected: null, value }] }))).status).toBe(200);
});
it.each([false, "true", [], {}, 2])("rejects malformed candidate value %s", async value => {
  expect((await PATCH(request({ initialBoard: null, changes: [{ field: "hiddenPeople", key: "driver:one", expected: null, value }] }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects arbitrary keys and malformed initial candidate map", async () => {
  expect((await PATCH(request({ initialBoard: null, changes: [{ field: "hiddenPeople", key: "arbitrary", expected: true, value: null }] }))).status).toBe(400);
  expect((await PATCH(request({ initialBoard: { version: 1, lanes: [], laneOrder: [], assignments: {}, hiddenPeople: { "driver:one": false } }, changes }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
