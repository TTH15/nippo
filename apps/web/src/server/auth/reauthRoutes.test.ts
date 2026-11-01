// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { decodeJwt } from "jose";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), identity: vi.fn(), otp: vi.fn(), send: vi.fn(), from: vi.fn(), rpc: vi.fn(), verify: vi.fn(), generate: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireAuth: mock.auth, isAuthError: (value: unknown) => value instanceof NextResponse }));
vi.mock("@/server/auth/reauthIdentity", () => ({ reauthIdentity: mock.identity }));
vi.mock("@/server/otp/twilio", () => ({ checkOtp: mock.otp, sendOtp: mock.send }));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@simplewebauthn/server", () => ({ verifyAuthenticationResponse: mock.verify, generateAuthenticationOptions: mock.generate, generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn() }));
vi.mock("@/server/auth/passkeyPolicy", async () => {
  const { requireRecentAuth } = await import("@/server/auth/recentAuth");
  return { passkeyManagementAuthorization: async (req: NextRequest, user: any) => await requireRecentAuth(req, user) ?? {}, recoverySessionHash: () => "fixture-hash" };
});
vi.mock("@/server/afterSafely", () => ({ afterSafely: vi.fn() }));
vi.mock("@/server/notifications/dispatch", () => ({ deliverStoredNotifications: vi.fn() }));
import { POST as verify } from "@/app/api/auth/reauth/verify/route";
import { POST as options } from "@/app/api/auth/reauth/options/route";
import { DELETE as remove } from "@/app/api/me/passkeys/route";
import { createChallengeToken, verifyChallengeToken } from "./webauthn";
import { bankAfterHash, bankBeforeHash } from "./bankChangeAuth";
import { hasRecentAuth, sessionFingerprint } from "./recentAuth";
const user = { driverId: "self", identityId: "person", orgId: "org", role: "DRIVER", companyCode: "TEST" };
const req = (body: object, session = "session") => new NextRequest("http://localhost/api/auth/reauth/verify", { method: "POST", headers: { authorization: `Bearer ${session}` }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", "reauth-route-test"); mock.auth.mockResolvedValue(user); mock.identity.mockResolvedValue({ phone: "+819000000001", hasPasskey: true }); mock.otp.mockResolvedValue(true); mock.send.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());
it("SMS送信先はリクエスト番号を無視し保存済みの本人番号を使う", async () => {
  expect((await options(req({ method: "sms", phone: "+819099999999" }))).status).toBe(200);
  expect(mock.send).toHaveBeenCalledWith("+819000000001", expect.any(NextRequest));
});
it("SMS検証後だけセッションに結び付いた証明を渡す", async () => {
  const request = req({ method: "sms", code: "123456", phone: "+819099999999" });
  const response = await verify(request);
  expect(response.status).toBe(200); expect(mock.otp).toHaveBeenCalledWith("+819000000001", "123456", expect.any(NextRequest));
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

const bankBefore = { bank_name: "以前の見本銀行", bank_no: "1234567", bank_holder: "ミホン タロウ" };
const bankAfter = { bankName: "新しい見本銀行", bankNo: "01234567", bankHolder: "ミホン タロウ" };
it("口座変更用のSMS確認・一般のreauth challenge・確認中の口座差し替えを拒否する", async () => {
  expect((await verify(req({ action: "bank_change", method: "sms", code: "123456", bank: bankAfter }))).status).toBe(400);
  const generic = await createChallengeToken({ purpose: "reauth", challenge: "generic", identityId: "person", sessionHash: sessionFingerprint(req({})) });
  expect((await verify(req({ action: "bank_change", method: "passkey", bank: bankAfter, challengeToken: generic, response: { id: "key" } }))).status).toBe(400);
  const dedicated = await createChallengeToken({ purpose: "bank_change", challenge: "bank", identityId: "person", sessionHash: sessionFingerprint(req({})), bankBeforeHash: bankBeforeHash(bankBefore), bankAfterHash: bankAfterHash(bankAfter) });
  expect((await verify(req({ action: "bank_change", method: "passkey", bank: { ...bankAfter, bankNo: "7777777" }, challengeToken: dedicated, response: { id: "key" } }))).status).toBe(400);
  expect(mock.otp).not.toHaveBeenCalled(); expect(mock.from).not.toHaveBeenCalled();
});
it("本人のパスキーのユーザー確認後だけ口座変更専用の確認情報を発行する", async () => {
  const token = await createChallengeToken({ purpose: "bank_change", challenge: "bank-once", identityId: "person", sessionHash: sessionFingerprint(req({})), bankBeforeHash: bankBeforeHash(bankBefore), bankAfterHash: bankAfterHash(bankAfter) });
  const query = { select: () => query, eq: () => query, update: () => query, maybeSingle: async () => ({ data: { id: "key-row", credential_id: "key", public_key: "\\x01", counter: 0 } }) };
  mock.from.mockReturnValue(query); mock.rpc.mockResolvedValue({ data: true });
  mock.verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });
  const response = await verify(req({ action: "bank_change", method: "passkey", bank: bankAfter, challengeToken: token, response: { id: "key" } }));
  expect(response.status).toBe(200); const body = await response.json();
  expect(body.bankChangeToken).toEqual(expect.any(String)); expect(body).not.toHaveProperty("reauthToken");
  expect(mock.verify).toHaveBeenCalledWith(expect.objectContaining({ requireUserVerification: true }));
});
it("表示した登録口座が既に変わっていれば、パスキー確認を始めない", async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: bankBefore }) };
  mock.from.mockReturnValue(query);
  const response = await options(req({ method: "passkey", action: "bank_change", bank: bankAfter, previousBank: { bankName: "さらに古い銀行", bankNo: "1234567", bankHolder: "ミホン タロウ" } }));
  expect(response.status).toBe(409); expect(mock.generate).not.toHaveBeenCalled();
});

it("編集開始は変更先が未入力でも本人の登録口座に結び付いたチャレンジを発行する", async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: bankBefore }), then: (resolve: (value: unknown) => void) => resolve({ data: [{ credential_id: "key" }] }) };
  mock.from.mockReturnValue(query); mock.generate.mockResolvedValue({ challenge: "edit" });
  const response = await options(req({ action: "bank_edit", method: "passkey", previousBank: { bankName: bankBefore.bank_name, bankNo: bankBefore.bank_no, bankHolder: bankBefore.bank_holder } }));
  expect(response.status).toBe(200);
  const token = (await response.json()).challengeToken;
  expect(await verifyChallengeToken(token, "bank_edit")).toMatchObject({ bankBeforeHash: bankBeforeHash(bankBefore), sessionHash: sessionFingerprint(req({})) });
  await expect(verifyChallengeToken(token, "reauth")).rejects.toThrow();
});
it("編集開始はSMSや汎用確認で代用できず、専用パスキー確認後だけ保存権限を発行する", async () => {
  expect((await options(req({ action: "bank_edit", method: "sms" }))).status).toBe(400);
  expect((await verify(req({ action: "bank_edit", method: "sms", code: "123456" }))).status).toBe(400);
  const generic = await createChallengeToken({ purpose: "reauth", challenge: "generic", identityId: "person", sessionHash: sessionFingerprint(req({})) });
  expect((await verify(req({ action: "bank_edit", method: "passkey", challengeToken: generic, response: { id: "key" } }))).status).toBe(400);
  expect(mock.from).not.toHaveBeenCalled();
  const token = await createChallengeToken({ purpose: "bank_edit", challenge: "edit-once", identityId: "person", sessionHash: sessionFingerprint(req({})), bankBeforeHash: bankBeforeHash(bankBefore) });
  const query = { select: () => query, eq: () => query, update: () => query, maybeSingle: async () => ({ data: { id: "key-row", credential_id: "key", public_key: "\\x01", counter: 0 } }) };
  mock.from.mockReturnValue(query); mock.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: false });
  mock.verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });
  const payload = { action: "bank_edit", method: "passkey", challengeToken: token, response: { id: "key" } };
  const response = await verify(req(payload)); expect(response.status).toBe(200);
  const body = await response.json(); expect(body).not.toHaveProperty("reauthToken");
  expect(decodeJwt(body.bankChangeToken)).toMatchObject({ kind: "bank_account_edit", bank_before_hash: bankBeforeHash(bankBefore) });
  expect((await verify(req(payload))).status).toBe(400);
  expect(mock.verify).toHaveBeenCalledWith(expect.objectContaining({ requireUserVerification: true }));
});
