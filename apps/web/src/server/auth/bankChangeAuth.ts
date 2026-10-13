import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { supabase } from "@/server/db/client";
import { sessionFingerprint, RECENT_AUTH_SECONDS } from "./recentAuth";
import type { AuthUser } from "./types";
import { bankAccountFromStorage, type BankAccount, type BankStorage } from "@/lib/bankAccount";

export type BankSnapshot = BankStorage;
const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(process.env.JWT_SECRET);
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bankBeforeHash = (bank: BankSnapshot) => hash([bank.bank_name, bank.bank_no, bank.bank_holder, bank.bank_branch_name ?? null, bank.bank_account_type ?? null, ...(bank.bank_account_type_other ? [bank.bank_account_type_other] : [])]);
export const bankAfterHash = (bank: BankAccount) => hash([bank.bankName, bank.bankNo, bank.bankHolder, bank.bankBranch ?? null, bank.bankType ?? null, ...(bank.bankTypeOther ? [bank.bankTypeOther] : [])]);
export const bankSnapshotValues = bankAccountFromStorage;

export async function readOwnBank(user: AuthUser): Promise<BankSnapshot> {
  // tenant-scope-ok: 呼び出し元のrequireAuthで確定した本人の所属行だけを参照する
  const { data, error } = await supabase.from("drivers").select("bank_name, bank_no, bank_holder, bank_branch_name, bank_account_type, bank_account_type_other").eq("id", user.driverId).maybeSingle();
  if (error || !data || ![data.bank_name, data.bank_no, data.bank_holder].every(value => value === null || typeof value === "string")) throw new Error("Bank status unavailable");
  return { bank_name: data.bank_name ?? null, bank_no: data.bank_no ?? null, bank_holder: data.bank_holder ?? null, bank_branch_name: data.bank_branch_name ?? null, bank_account_type: data.bank_account_type ?? null, bank_account_type_other: data.bank_account_type_other ?? null };
}

/** パスキー検証済みの口座変更用。編集開始では変更前口座を束縛し、保存で一度だけ消費する。 */
export async function issueBankChangeGrant(req: NextRequest, user: AuthUser, before: string, after: string | null): Promise<string> {
  if (!user.identityId || !req.headers.get("authorization")) throw new Error("Missing authenticated identity");
  return new SignJWT({ kind: after === null ? "bank_account_edit" : "bank_account_change", method: "passkey", identity_id: user.identityId,
    driver_id: user.driverId, org_id: user.orgId, token_version: user.tokenVersion ?? 0,
    session_hash: sessionFingerprint(req), bank_before_hash: before, bank_after_hash: after ?? undefined })
    .setProtectedHeader({ alg: "HS256" }).setJti(randomUUID()).setIssuedAt()
    .setExpirationTime(`${RECENT_AUTH_SECONDS}s`).sign(secret());
}

/** 既存のログイン・SMS・パスキー管理用の確認情報では口座を書き換えられない。 */
export async function consumeBankChangeGrant(req: NextRequest, user: AuthUser, before: BankSnapshot, after: BankAccount): Promise<boolean> {
  const grant = req.headers.get("x-bank-change-token");
  if (!grant || !user.identityId) return false;
  let payload;
  try { payload = (await jwtVerify(grant, secret(), { algorithms: ["HS256"] })).payload; }
  catch { return false; }
  const now = Math.floor(Date.now() / 1000);
  if (!["bank_account_change", "bank_account_edit"].includes(String(payload.kind)) || payload.method !== "passkey" ||
      payload.identity_id !== user.identityId || payload.driver_id !== user.driverId || payload.org_id !== user.orgId ||
      payload.token_version !== (user.tokenVersion ?? 0) || payload.session_hash !== sessionFingerprint(req) ||
      payload.bank_before_hash !== bankBeforeHash(before) ||
      (payload.kind === "bank_account_change" && payload.bank_after_hash !== bankAfterHash(after)) ||
      (payload.kind === "bank_account_edit" && payload.bank_after_hash !== undefined) ||
      typeof payload.iat !== "number" || payload.iat > now || now - payload.iat >= RECENT_AUTH_SECONDS ||
      typeof payload.exp !== "number" || typeof payload.jti !== "string" || !/^[0-9a-f-]{36}$/.test(payload.jti)) return false;
  // WebAuthnの使用済み記録を共用し、同じ確認情報の再利用を原子的に拒否する。
  const { data, error } = await supabase.rpc("consume_webauthn_challenge", {
    p_challenge_hash: createHash("sha256").update(`bank_change_grant\0${payload.jti}`).digest("hex"),
    p_expires_at: new Date(payload.exp * 1000).toISOString(),
  });
  if (error) throw new Error("Bank confirmation unavailable");
  return data === true;
}
