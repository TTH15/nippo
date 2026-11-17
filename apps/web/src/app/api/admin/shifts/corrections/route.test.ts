// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), caps: new Set(["can_manage_members", "can_manage_shifts", "can_edit_reports"]) }));
vi.mock("@/server/auth", () => ({ requirePermission: async () => ({ driverId: "actor", orgId: "org", capabilities: mock.caps }), isAuthError: (v: unknown) => v instanceof NextResponse }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: mock.rpc } }));
import { POST } from "./route";
const driverId = "00000000-0000-4000-8000-000000000004";
const request = (body: unknown) => new NextRequest("http://localhost/api/admin/shifts/corrections", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { mock.rpc.mockReset().mockResolvedValue({ data: "session", error: null }); mock.caps = new Set(["can_manage_members", "can_manage_shifts", "can_edit_reports"]); });
it("管理者が理由なしで修正を開始する", async () => {
  expect((await POST(request({ driverId, date: "2026-11-16" }))).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("begin_shift_correction", { p_org: "org", p_actor: "actor", p_driver: driverId, p_date: "2026-11-16", p_reason: null });
});
it("シフトと日報の権限不足や不正な日付では開始しない", async () => {
  mock.caps.delete("can_edit_reports");
  expect((await POST(request({ driverId, date: "2026-11-16", reason: "修正" }))).status).toBe(403);
  mock.caps.add("can_edit_reports");
  expect((await POST(request({ driverId, date: "invalid" }))).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("他社または重複した修正を拒否する", async () => {
  mock.rpc.mockResolvedValue({ error: { code: "P0002" } });
  expect((await POST(request({ driverId, date: "2026-11-16", reason: "修正" }))).status).toBe(404);
  mock.rpc.mockResolvedValue({ error: { code: "23505" } });
  expect((await POST(request({ driverId, date: "2026-11-16", reason: "修正" }))).status).toBe(409);
});
