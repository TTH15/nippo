// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), identity: vi.fn(), otp: vi.fn(), send: vi.fn(), from: vi.fn(), rpc: vi.fn(), verify: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireAuth: mock.auth, isAuthError: (value: unknown) => value instanceof NextResponse }));
vi.mock("@/server/auth/reauthIdentity", () => ({ reauthIdentity: mock.identity }));
vi.mock("@/server/otp/twilio", () => ({ checkOtp: mock.otp, sendOtp: mock.send }));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@simplewebauthn/server", () => ({ verifyAuthenticationResponse: mock.verify, generateAuthenticationOptions: vi.fn(), generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn() }));
vi.mock("@/server/afterSafely", () => ({ afterSafely: vi.fn() }));
vi.mock("@/server/notifications/dispatch", () => ({ deliverStoredNotifications: vi.fn() }));
import { POST as verify } from "@/app/api/auth/reauth/verify/route";
import { POST as options } from "@/app/api/auth/reauth/options/route";
import { DELETE as remove } from "@/app/api/me/passkeys/route";
import { createChallengeToken } from "./webauthn";
import { hasRecentAuth, sessionFingerprint } from "./recentAuth";
const user = { driverId: "self", identityId: "person", orgId: "org", role: "DRIVER", companyCode: "TEST" };
const req = (body: object, session = "session") => new NextRequest("http://localhost/api/auth/reauth/verify", { method: "POST", headers: { authorization: `Bearer ${session}` }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", "reauth-route-test"); mock.auth.mockResolvedValue(user); mock.identity.mockResolvedValue({ phone: "+819000000001", hasPasskey: true }); mock.otp.mockResolvedValue(true); mock.send.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());
it("SMS送信先はリクエスト番号を無視し保存済みの本人番号を使う", async () => {
  expect((await options(req({ method: "sms", phone: "+819099999999" }))).status).toBe(200);
  expect(mock.send).toHaveBeenCalledWith("+819000000001");
});
it("SMS検証後だけセッションに結び付いた証明を渡す", async () => {
  const request = req({ method: "sms", code: "123456", phone: "+819099999999" });
  const response = await verify(request);
  expect(response.status).toBe(200); expect(mock.otp).toHaveBeenCalledWith("+819000000001", "123456");
  const { reauthToken } = await response.json();
  const check = req({}); check.headers.set("x-reauth-token", reauthToken);
  expect(await hasRecentAuth(check, user)).toBe(true);
  mock.otp.mockResolvedValue(false); expect((await verify(req({ method: "sms", code: "123456" }))).status).toBe(400);
});
it("電話情報の取得失敗や未確認番号ではSMSも証明も発行しない", async () => {
  mock.identity.mockRejectedValue(new Error("offline"));
  expect((await options(req({ method: "sms" }))).status).toBe(503);
  expect((await verify(req({ method: "sms", code: "123456" }))).status).toBe(503);
  expect(mock.otp).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
  mock.identity.mockResolvedValue({ phone: null });
  expect((await verify(req({ method: "sms", code: "123456" }))).status).toBe(400);
});
it("別セッション・別人のPasskey確認を鍵検索より前に拒否する", async () => {
  for (const [identityId, session] of [["other", "session"], ["person", "other-session"]]) {
    const token = await createChallengeToken({ purpose: "reauth", challenge: "test", identityId, sessionHash: sessionFingerprint(req({}, session)) });
    expect((await verify(req({ method: "passkey", challengeToken: token, response: { id: "key" } }))).status).toBe(400);
  }
  expect(mock.from).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled();
});
it("Passkey確認の再送は証明を発行しない。カウンター0でも1回だけ", async () => {
  const token = await createChallengeToken({ purpose: "reauth", challenge: "one-use", identityId: "person", sessionHash: sessionFingerprint(req({})) });
  const filters: unknown[] = []; const query = { select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query; }, update: () => query,
    maybeSingle: async () => ({ data: { id: "key-row", credential_id: "key", public_key: "\\x01", counter: 0 } }) };
  mock.from.mockReturnValue(query); mock.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: false });
  mock.verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });
  const payload = { method: "passkey", challengeToken: token, response: { id: "key" } };
  expect((await verify(req(payload))).status).toBe(200); expect((await verify(req(payload))).status).toBe(400);
  expect(filters).toContainEqual(["identity_id", "person"]);
  expect(mock.verify).toHaveBeenCalledWith(expect.objectContaining({ requireUserVerification: true }));
});
it("削除は直近確認がなければDBに到達しない", async () => {
  expect((await remove(req({ id: "00000000-0000-0000-0000-000000000001" }))).status).toBe(403);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("削除の対象本人はセッションから決め、復旧手段なしを409にする", async () => {
  mock.auth.mockResolvedValue({ ...user, strongAuthAt: Math.floor(Date.now() / 1000), strongAuthMethod: "sms" });
  mock.rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
  expect((await remove(req({ id: "00000000-0000-0000-0000-000000000001", identityId: "other" }))).status).toBe(409);
  expect(mock.rpc).toHaveBeenCalledWith("manage_passkey", expect.objectContaining({ p_identity_id: "person", p_driver_id: "self", p_org_id: "org" }));
});
