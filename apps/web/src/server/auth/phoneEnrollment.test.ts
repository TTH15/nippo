// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ enrollment: vi.fn(), send: vi.fn(), check: vi.fn(), from: vi.fn(), grant: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireAuth: async () => ({ driverId: "self", identityId: "person", orgId: "org" }), isAuthError: (x: unknown) => x instanceof NextResponse }));
vi.mock("@/server/identity", () => ({ resolveIdentityId: async () => "person" }));
vi.mock("./phoneEnrollment", () => ({ phoneEnrollment: m.enrollment }));
vi.mock("@/server/otp/twilio", () => ({ sendOtp: m.send, checkOtp: m.check }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("./recentAuth", () => ({ issueRecentAuthGrant: m.grant }));
import { POST as send } from "@/app/api/me/phone/send/route";
import { POST as verify } from "@/app/api/me/phone/verify/route";
const req = (phone = "09000000001") => new NextRequest("http://localhost/api/me/phone", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) });
beforeEach(() => { vi.resetAllMocks(); m.grant.mockResolvedValue("session-bound-proof"); m.enrollment.mockResolvedValue({ identity: { phone: "+819000000001", phone_verified_at: null }, phone: "+819000000001" }); });
it("保存済み番号と違う入力ではOTPを送信・検証せず鍵管理の迂回を防ぐ", async () => {
  expect((await send(req("09099999999"))).status).toBe(403);
  expect((await verify(req("09099999999"))).status).toBe(403);
  expect(m.send).not.toHaveBeenCalled(); expect(m.check).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});
it("本人情報が読めないときは閉じる", async () => {
  m.enrollment.mockRejectedValue(new Error("offline"));
  expect((await send(req())).status).toBe(503); expect((await verify(req())).status).toBe(503);
  expect(m.send).not.toHaveBeenCalled(); expect(m.check).not.toHaveBeenCalled();
});
it("保存済み番号へはSMSを送れる", async () => {
  expect((await send(req())).status).toBe(200); expect(m.send).toHaveBeenCalledWith("+819000000001");
});
it("同時の番号変更・確認済み化で上書きせず409にする", async () => {
  m.check.mockResolvedValue(true);
  const filters: unknown[] = []; const q = { update: () => q, select: () => q, eq: (...x: unknown[]) => { filters.push(x); return q; }, is: (...x: unknown[]) => { filters.push(x); return q; }, maybeSingle: async () => ({ data: null, error: null }) };
  m.from.mockReturnValue(q);
  expect((await verify(req())).status).toBe(409);
  expect(filters).toContainEqual(["id", "person"]); expect(filters).toContainEqual(["phone", "+819000000001"]); expect(filters).toContainEqual(["phone_verified_at", null]);
  expect(m.grant).not.toHaveBeenCalled();
});

const withoutPhone = () => new NextRequest("http://localhost/api/me/phone", {
  method: "POST", headers: { authorization: "Bearer existing-session" }, body: JSON.stringify({ code: "123456" }),
});
it("日報では番号を受け取らずサーバー保存済み番号へ送る", async () => {
  expect((await send(withoutPhone())).status).toBe(200);
  expect(m.send).toHaveBeenCalledWith("+819000000001");
});
it("誤ったコードでは確認証明もDB更新も行わない", async () => {
  m.check.mockResolvedValue(false);
  expect((await verify(withoutPhone())).status).toBe(400);
  expect(m.from).not.toHaveBeenCalled(); expect(m.grant).not.toHaveBeenCalled();
});
it("SMS確認と条件付き保存が成功したときだけ同一セッションの確認証明を返す", async () => {
  m.check.mockResolvedValue(true);
  const q = { update: () => q, select: () => q, eq: () => q, is: () => q,
    maybeSingle: async () => ({ data: { id: "person" }, error: null }) };
  m.from.mockReturnValue(q);
  const request = withoutPhone(); const res = await verify(request);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, reauthToken: "session-bound-proof" });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(m.grant).toHaveBeenCalledWith(request, expect.objectContaining({ driverId: "self", identityId: "person", orgId: "org" }));
});
it("保存に失敗した番号には本人確認証明を出さない", async () => {
  m.check.mockResolvedValue(true);
  const q = { update: () => q, select: () => q, eq: () => q, is: () => q,
    maybeSingle: async () => ({ data: null, error: { code: "23505" } }) };
  m.from.mockReturnValue(q);
  expect((await verify(withoutPhone())).status).toBe(409);
  expect(m.grant).not.toHaveBeenCalled();
});
it("保存済み番号なし・確認済みでは送信と検証を進めない", async () => {
  m.enrollment.mockResolvedValue({ identity: { phone: null, phone_verified_at: null }, phone: null });
  expect((await send(withoutPhone())).status).toBe(400);
  expect((await verify(withoutPhone())).status).toBe(400);
  m.enrollment.mockResolvedValue({ identity: { phone: "+819000000001", phone_verified_at: "2026-09-17" }, phone: "+819000000001" });
  expect((await send(withoutPhone())).status).toBe(409);
  expect((await verify(withoutPhone())).status).toBe(409);
  expect(m.send).not.toHaveBeenCalled(); expect(m.check).not.toHaveBeenCalled(); expect(m.grant).not.toHaveBeenCalled();
});
