import { authLimitResponse } from "@/server/auth/requestBudget";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { normalizeBankAccount, bankFields } from "@/lib/bankAccount";
import { readOwnBank, bankBeforeHash, bankAfterHash, bankSnapshotValues } from "@/server/auth/bankChangeAuth";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { reauthIdentity } from "@/server/auth/reauthIdentity";
import { sessionFingerprint } from "@/server/auth/recentAuth";
import { supabase } from "@/server/db/client";
import { sendOtp } from "@/server/otp/twilio";
import { generateAuthenticationOptions, createChallengeToken, rpConfig } from "@/server/auth/webauthn";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (!user.identityId) return NextResponse.json({ error: "本人確認の設定がありません" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (body?.method !== "sms" && body?.method !== "passkey") return NextResponse.json({ error: "本人確認の方法を選んでください" }, { status: 400 });
  const bankEdit = body?.action === "bank_edit";
  const bankChange = body?.action === "bank_change";
  if (body?.action !== undefined && !bankChange && !bankEdit) return NextResponse.json({ error: "本人確認の用途が正しくありません" }, { status: 400 });
  const bank = bankChange ? normalizeBankAccount(body.bank) : null;
  if ((bankChange || bankEdit) && (body.method !== "passkey" || (bankChange && !bank))) return NextResponse.json({ error: "振込口座の変更はパスキーで確認してください" }, { status: 400 });
  try {
    const before = bankChange || bankEdit ? await readOwnBank(user) : null;
    if (before) {
      const visible = body.previousBank;
      const current = bankSnapshotValues(before);
      if (!visible || !bankFields.every(key => (visible[key] === undefined || typeof visible[key] === "string") && (visible[key] ?? "").trim() === (current[key] ?? "").trim())) return NextResponse.json({ error: "振込口座が変更されています。登録内容を読み込み直してください", code: "BANK_ACCOUNT_CHANGED" }, { status: 409 });
    }
    if (body.method === "sms") {
      const { phone, phoneMasked } = await reauthIdentity(user.identityId);
      if (!phone) return NextResponse.json({ error: "確認済みの電話番号がありません。運営にお問い合わせください" }, { status: 409 });
      await sendOtp(phone, req);
      return NextResponse.json({ ok: true, phoneMasked });
    }
    const { data: credentials, error } = await supabase.from("passkey_credentials")
      .select("credential_id, transports").eq("identity_id", user.identityId);
    if (error) throw error;
    if (!credentials?.length) return NextResponse.json({ error: "かんたんログインが設定されていません" }, { status: 409 });
    const options = await generateAuthenticationOptions({ rpID: rpConfig().rpID, userVerification: "required",
      allowCredentials: credentials.map((c) => ({ id: c.credential_id as string, transports: (c.transports as AuthenticatorTransportFuture[] | null) ?? undefined })) });
    const challengeToken = await createChallengeToken({ challenge: options.challenge, purpose: bankEdit ? "bank_edit" : bankChange ? "bank_change" : "reauth",
      identityId: user.identityId, sessionHash: sessionFingerprint(req),
      ...(before ? { bankBeforeHash: bankBeforeHash(before), ...(bank ? { bankAfterHash: bankAfterHash(bank) } : {}) } : {}) });
    return NextResponse.json({ options, challengeToken });
  } catch (err) {
    const limited = authLimitResponse(err);
    if (limited) return limited;
    return NextResponse.json({ error: "本人確認を開始できませんでした。時間をおいてお試しください" }, { status: 503 });
  }
}
