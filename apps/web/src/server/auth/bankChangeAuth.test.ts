// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeJwt } from "jose";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: m.rpc } }));
import { bankBeforeHash, consumeBankChangeGrant, issueBankChangeGrant, bankAfterHash } from "./bankChangeAuth";
import { freshStrongAuth, issueRecentAuthGrant } from "./recentAuth";
import { SimpleJwtAuthProvider } from "./jwt";
const user = { driverId: "self", identityId: "person", orgId: "org", role: "DRIVER", companyCode: "TEST", tokenVersion: 2 };
const before = { bank_name: "見本銀行", bank_no: "1234567", bank_holder: "ミホン タロウ" };
const after = { bankName: "別の見本銀行", bankNo: "01234567", bankHolder: "ミホン タロウ" };
const req = (token?: string, session = "session") => new NextRequest("http://localhost/api/me/registration", { headers: { authorization: `Bearer ${session}`, ...(token ? { "x-bank-change-token": token } : {}) } });
beforeEach(() => { vi.stubEnv("JWT_SECRET", "bank-change-test-secret"); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T00:00:00Z")); m.rpc.mockReset().mockResolvedValue({ data: true }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const issue = () => issueBankChangeGrant(req(), user, bankBeforeHash(before), bankAfterHash(after));
it("専用確認情報は1回限りで、口座の原文を含まずログインにも使えない", async () => {
  const proof = await issue();
  expect(JSON.stringify(decodeJwt(proof))).not.toContain("ミホン");
  m.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: false });
  expect(await consumeBankChangeGrant(req(proof), user, before, after)).toBe(true);
  expect(await consumeBankChangeGrant(req(proof), user, before, after)).toBe(false);
  await expect(new SimpleJwtAuthProvider().verify(`Bearer ${proof}`)).rejects.toThrow();
});
it("SMS・直近のパスキーログイン・鍵管理用の確認では口座変更できない", async () => {
  expect(await consumeBankChangeGrant(req(), { ...user, ...freshStrongAuth("passkey") }, before, after)).toBe(false);
  for (const method of ["sms", "passkey"] as const) {
    const proof = await issueRecentAuthGrant(req(), { ...user, ...freshStrongAuth(method) });
    expect(await consumeBankChangeGrant(req(proof), user, before, after)).toBe(false);
  }
  expect(m.rpc).not.toHaveBeenCalled();
});
it.each([{ identityId: "other" }, { driverId: "other" }, { orgId: "other" }, { tokenVersion: 3 }])("別人・所属・認証世代の変更を拒否する: %j", async change => {
  expect(await consumeBankChangeGrant(req(await issue()), { ...user, ...change }, before, after)).toBe(false);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("別セッション・変更前/後口座の差し替え・署名改変・期限切れを拒否する", async () => {
  const proof = await issue();
  expect(await consumeBankChangeGrant(req(proof, "other"), user, before, after)).toBe(false);
  expect(await consumeBankChangeGrant(req(proof), user, { ...before, bank_no: "7777777" }, after)).toBe(false);
  expect(await consumeBankChangeGrant(req(proof), user, before, { ...after, bankNo: "7777777" })).toBe(false);
  expect(await consumeBankChangeGrant(req(proof + "x"), user, before, after)).toBe(false);
  vi.advanceTimersByTime(300000);
  expect(await consumeBankChangeGrant(req(proof), user, before, after)).toBe(false);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("使用済み記録が保存できない場合は成功にしない", async () => {
  m.rpc.mockResolvedValue({ error: { message: "offline" } });
  await expect(consumeBankChangeGrant(req(await issue()), user, before, after)).rejects.toThrow();
});
