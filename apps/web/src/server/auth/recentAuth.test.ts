// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasRecentAuth, hasRecentStrongAuth, issueRecentAuthGrant, freshStrongAuth } from "./recentAuth";
import { signToken, SimpleJwtAuthProvider } from "./jwt";
import type { AuthUser } from "./types";
const user: AuthUser = { driverId: "driver", identityId: "person", orgId: "org", role: "DRIVER", companyCode: "TEST", tokenVersion: 2 };
const request = (grant?: string, session = "session-a") => new NextRequest("http://localhost/api/me/passkeys", { headers: { authorization: `Bearer ${session}`, ...(grant ? { "x-reauth-token": grant } : {}) } });
beforeEach(() => { vi.stubEnv("JWT_SECRET", "recent-auth-test-secret"); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-17T00:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("直近の本人確認", () => {
  it("旧JWT・確認方法なし・未来の時刻は再確認が必要", () => {
    expect(hasRecentStrongAuth(user)).toBe(false);
    expect(hasRecentStrongAuth({ ...user, strongAuthAt: Date.now() / 1000 })).toBe(false);
    expect(hasRecentStrongAuth({ ...user, ...freshStrongAuth("sms"), strongAuthAt: Date.now() / 1000 + 1 })).toBe(false);
  });
  it("SMSとPasskeyの証明は5分未満だけ有効", async () => {
    const verified = { ...user, ...freshStrongAuth("sms") };
    expect(await hasRecentAuth(request(), verified)).toBe(true);
    vi.advanceTimersByTime(299000); expect(hasRecentStrongAuth(verified)).toBe(true);
    vi.advanceTimersByTime(1000); expect(hasRecentStrongAuth(verified)).toBe(false);
  });
  it("セッション再発行後も元の認証時刻を維持し、期限を延長しない", async () => {
    const old = { ...user, ...freshStrongAuth("passkey") };
    const provider = new SimpleJwtAuthProvider();
    vi.advanceTimersByTime(299000);
    const refreshed = await provider.verify(`Bearer ${await signToken(old)}`);
    expect(refreshed.strongAuthAt).toBe(old.strongAuthAt);
    vi.advanceTimersByTime(1000); expect(hasRecentStrongAuth(refreshed)).toBe(false);
  });
  it("証明は本人・所属・世代・セッションに拘束される", async () => {
    const grant = await issueRecentAuthGrant(request(), user);
    expect(await hasRecentAuth(request(grant), user)).toBe(true);
    for (const change of [{ identityId: "other" }, { driverId: "other" }, { orgId: "other" }, { tokenVersion: 3 }]) {
      expect(await hasRecentAuth(request(grant), { ...user, ...change })).toBe(false);
    }
    expect(await hasRecentAuth(request(grant, "session-b"), user)).toBe(false);
    expect(await hasRecentAuth(request(grant + "x"), user)).toBe(false);
    await expect(new SimpleJwtAuthProvider().verify(`Bearer ${grant}`)).rejects.toThrow();
    vi.advanceTimersByTime(300000); expect(await hasRecentAuth(request(grant), user)).toBe(false);
  });
});

it("署名済みの業務・運営JWTは同じ親ログインのパスキー確認だけ共有する", async () => {
  const provider = new SimpleJwtAuthProvider();
  const parent = "00000000-0000-4000-8000-000000000001";
  const workToken = await signToken({ ...user, sessionId: parent });
  const adminToken = await signToken({ ...user, purpose: "admin", parentSessionId: parent });
  const work = await provider.verify(`Bearer ${workToken}`);
  const admin = await provider.verify(`Bearer ${adminToken}`);
  const grant = await issueRecentAuthGrant(request(undefined, workToken), work, "passkey");
  expect(await hasRecentAuth(request(grant, adminToken), admin, "passkey")).toBe(true);
  const otherToken = await signToken({ ...user, purpose: "admin", parentSessionId: "00000000-0000-4000-8000-000000000002" });
  expect(await hasRecentAuth(request(grant, otherToken), await provider.verify(`Bearer ${otherToken}`), "passkey")).toBe(false);
  const smsGrant = await issueRecentAuthGrant(request(undefined, workToken), work, "sms");
  expect(await hasRecentAuth(request(smsGrant, adminToken), admin, "passkey")).toBe(false);
  vi.advanceTimersByTime(1000);
  const renewed = await signToken({ ...work });
  expect(await hasRecentAuth(request(grant, renewed), await provider.verify(`Bearer ${renewed}`), "passkey")).toBe(true);
  vi.advanceTimersByTime(299000);
  expect(await hasRecentAuth(request(grant, adminToken), admin, "passkey")).toBe(false);
});
