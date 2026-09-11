// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: db }));
import { createChallengeToken, verifyChallengeToken, consumeChallengeToken } from "./webauthn";

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "webauthn-challenge-test-secret");
  db.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Passkeyチャレンジの一回性", () => {
  it("署名済みチャレンジの期限・用途を維持し、DBへはハッシュだけ渡す", async () => {
    const token = await createChallengeToken({ challenge: "secret-challenge", purpose: "login" });
    expect(await verifyChallengeToken(token, "login")).toMatchObject({ challenge: "secret-challenge", identityId: null });
    expect(await consumeChallengeToken(token, "login")).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("consume_webauthn_challenge", {
      p_challenge_hash: expect.stringMatching(/^[0-9a-f]{64}$/), p_expires_at: expect.any(String),
    });
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain("secret-challenge");
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain(token);
  });

  it("使用済みは失敗する", async () => {
    const token = await createChallengeToken({ challenge: "used", purpose: "login" });
    db.rpc.mockResolvedValue({ data: false, error: null });
    expect(await consumeChallengeToken(token, "login")).toBe(false);
  });

  it("JWTが違っても同じ用途・チャレンジのハッシュは同じ", async () => {
    vi.useFakeTimers();
    const first = await createChallengeToken({ challenge: "same", purpose: "login" });
    vi.advanceTimersByTime(1000);
    const second = await createChallengeToken({ challenge: "same", purpose: "login" });
    expect(first).not.toBe(second);
    await consumeChallengeToken(first, "login");
    await consumeChallengeToken(second, "login");
    expect(db.rpc.mock.calls[0][1].p_challenge_hash).toBe(db.rpc.mock.calls[1][1].p_challenge_hash);
  });

  it("5分後はDBへ到達せず拒否する", async () => {
    vi.useFakeTimers();
    const token = await createChallengeToken({ challenge: "expired", purpose: "login" });
    vi.advanceTimersByTime(300_000);
    expect(await consumeChallengeToken(token, "login")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("用途違い・別人の登録チャレンジを消費しない", async () => {
    const token = await createChallengeToken({ challenge: "register", purpose: "register", identityId: "person-a" });
    expect(await consumeChallengeToken(token, "login")).toBe(false);
    expect(await consumeChallengeToken(token, "register", "person-b")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await consumeChallengeToken(token, "register", "person-a")).toBe(true);
  });

  it("期限の無いJWTを受け付けない", async () => {
    const token = await new SignJWT({ kind: "webauthn_challenge", purpose: "login", challenge: "no-exp" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect(await consumeChallengeToken(token, "login")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("署名改ざん・異なるアルゴリズムを拒否する", async () => {
    const token = await new SignJWT({ kind: "webauthn_challenge", purpose: "login", challenge: "bad" })
      .setProtectedHeader({ alg: "HS384" }).setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect(await consumeChallengeToken(token, "login")).toBe(false);
    expect(await consumeChallengeToken("invalid.jwt.token", "login")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("DB障害は成功扱いにしない", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    const token = await createChallengeToken({ challenge: "outage", purpose: "login" });
    await expect(consumeChallengeToken(token, "login")).rejects.toThrow("Failed to consume");
  });
});
