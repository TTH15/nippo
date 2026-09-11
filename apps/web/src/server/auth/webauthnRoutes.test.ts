// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), insert: vi.fn(), update: vi.fn(),
  verifyLogin: vi.fn(), verifyRegister: vi.fn(), issueSession: vi.fn(), resolveDriver: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: mock.verifyLogin,
  verifyRegistrationResponse: mock.verifyRegister,
  generateAuthenticationOptions: vi.fn(), generateRegistrationOptions: vi.fn(),
}));
vi.mock("@/server/auth", () => ({ requireAuth: mock.requireAuth, isAuthError: () => false }));
vi.mock("@/server/identity", () => ({
  resolveActiveDriverByIdentity: mock.resolveDriver,
  issueDriverSession: mock.issueSession,
  describeIdentityLoginFailure: vi.fn(),
}));
import { createChallengeToken } from "./webauthn";
import { POST as login } from "@/app/api/auth/webauthn/login/verify/route";
import { POST as register } from "@/app/api/auth/webauthn/register/verify/route";

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "passkey-route-test-secret");
  vi.clearAllMocks();
  const used = new Set<string>();
  mock.rpc.mockImplementation(async (_name, args) => {
    const fresh = !used.has(args.p_challenge_hash);
    used.add(args.p_challenge_hash);
    return { data: fresh, error: null };
  });
  mock.update.mockResolvedValue({ data: { id: "credential-row" }, error: null });
  mock.insert.mockResolvedValue({ error: null });
  mock.from.mockImplementation(() => {
    let updating = false;
    const query = {
      select: () => query,
      eq: () => query,
      update: () => { updating = true; return query; },
      insert: mock.insert,
      maybeSingle: () => updating ? mock.update() : Promise.resolve({
        data: { id: "credential-row", identity_id: "person-a", credential_id: "credential", public_key: "\\x01", counter: 0 }, error: null,
      }),
    };
    return query;
  });
  mock.verifyLogin.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });
  mock.verifyRegister.mockResolvedValue({ verified: true, registrationInfo: {
    credential: { id: "credential", publicKey: new Uint8Array([1]), counter: 0 },
    credentialDeviceType: "multiDevice", credentialBackedUp: true,
  } });
  mock.requireAuth.mockResolvedValue({ driverId: "driver-a", identityId: "person-a" });
  mock.resolveDriver.mockResolvedValue({ driver: { id: "driver-a" } });
  mock.issueSession.mockResolvedValue({ token: "test-session" });
});
afterEach(() => vi.unstubAllEnvs());

const request = (token: string) => new NextRequest("http://localhost/api/auth/webauthn/verify", {
  method: "POST", body: JSON.stringify({ challengeToken: token, response: { id: "credential" } }),
});
const loginToken = (challenge = "login") => createChallengeToken({ purpose: "login", challenge });
const registerToken = (identityId = "person-a") => createChallengeToken({ purpose: "register", challenge: "register", identityId });

describe("Passkeyログインの再送", () => {
  it("counter=0でも同じ応答は1回だけセッションを発行する", async () => {
    const token = await loginToken();
    expect((await login(request(token))).status).toBe(200);
    expect((await login(request(token))).status).toBe(401);
    expect(mock.issueSession).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenCalledTimes(1);
  });
  it("同時送信でも1回だけ発行する", async () => {
    const token = await loginToken();
    const results = await Promise.all([login(request(token)), login(request(token))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    expect(mock.issueSession).toHaveBeenCalledTimes(1);
  });
  it("新しいチャレンジならcounter=0のPasskeyを継続利用できる", async () => {
    expect((await login(request(await loginToken("first")))).status).toBe(200);
    expect((await login(request(await loginToken("second")))).status).toBe(200);
    expect(mock.issueSession).toHaveBeenCalledTimes(2);
  });
  it("不正な認証応答はチャレンジを消費しない", async () => {
    mock.verifyLogin.mockResolvedValue({ verified: false });
    expect((await login(request(await loginToken()))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.issueSession).not.toHaveBeenCalled();
  });
  it("消費記録のDB障害でセッションを発行しない", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect((await login(request(await loginToken()))).status).toBe(503);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.issueSession).not.toHaveBeenCalled();
  });
  it("カウンターの保存失敗・競合でもセッションを発行しない", async () => {
    mock.update.mockResolvedValue({ data: null, error: null });
    expect((await login(request(await loginToken()))).status).toBe(503);
    expect(mock.issueSession).not.toHaveBeenCalled();
  });
});

describe("Passkey登録の再送", () => {
  it("同時送信でも鍵の保存は1回だけ", async () => {
    const token = await registerToken();
    const results = await Promise.all([register(request(token)), register(request(token))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    expect(mock.insert).toHaveBeenCalledTimes(1);
  });
  it("他人のチャレンジを消費・保存しない", async () => {
    expect((await register(request(await registerToken("person-b")))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("認証失敗は消費・保存しない", async () => {
    mock.verifyRegister.mockResolvedValue({ verified: false });
    expect((await register(request(await registerToken()))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("消費記録のDB障害で鍵を保存しない", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect((await register(request(await registerToken()))).status).toBe(503);
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
