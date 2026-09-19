// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), enrollment: vi.fn(), from: vi.fn(), eq: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireAuth: m.auth, isAuthError: (x: unknown) => x instanceof NextResponse }));
vi.mock("@/server/auth/phoneEnrollment", () => ({ phoneEnrollment: m.enrollment }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
import { GET } from "./route";
const request = () => new NextRequest("http://localhost/api/me/login-setup?identityId=someone-else");
beforeEach(() => {
  vi.resetAllMocks(); m.auth.mockResolvedValue({ identityId: "self", driverId: "member", orgId: "org" });
  m.enrollment.mockResolvedValue({ identity: { phone: "+819000000001", phone_verified_at: null }, phone: "+819000000001" });
  m.eq.mockResolvedValue({ count: 0, error: null }); m.from.mockReturnValue({ select: () => ({ eq: m.eq }) });
});
it("本人の登録状態だけを返し、電話番号全文を出さない", async () => {
  const res = await GET(request());
  expect(await res.json()).toEqual({ phoneVerified: false, phoneMasked: "下4桁 0001", hasPasskey: false });
  expect(m.eq).toHaveBeenCalledWith("identity_id", "self");
  expect(res.headers.get("cache-control")).toBe("no-store");
});
it("電話番号の確認と鍵の登録を別々に判定する", async () => {
  m.eq.mockResolvedValue({ count: 1, error: null });
  expect(await (await GET(request())).json()).toMatchObject({ phoneVerified: false, hasPasskey: true });
  m.enrollment.mockResolvedValue({ identity: { phone: "+819000000001", phone_verified_at: "2026-09-17" }, phone: "+819000000001" });
  expect(await (await GET(request())).json()).toMatchObject({ phoneVerified: true, hasPasskey: true });
});
it("DBの取得失敗を未登録や完了と誤表示しない", async () => {
  m.eq.mockResolvedValue({ count: null, error: { message: "unavailable" } });
  expect((await GET(request())).status).toBe(503);
  m.eq.mockResolvedValue({ count: 0, error: null }); m.enrollment.mockRejectedValue(new Error("unavailable"));
  expect((await GET(request())).status).toBe(503);
});
it("認可失敗・本人設定なしでは個人情報を読まない", async () => {
  m.auth.mockResolvedValue(NextResponse.json({ error: "停止済み" }, { status: 401 }));
  expect((await GET(request())).status).toBe(401);
  m.auth.mockResolvedValue({ identityId: null });
  expect((await GET(request())).status).toBe(400);
  expect(m.enrollment).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});
