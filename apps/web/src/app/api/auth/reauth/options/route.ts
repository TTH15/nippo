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
  try {
    if (body.method === "sms") {
      const { phone, phoneMasked } = await reauthIdentity(user.identityId);
      if (!phone) return NextResponse.json({ error: "確認済みの電話番号がありません。運営にお問い合わせください" }, { status: 409 });
      await sendOtp(phone);
      return NextResponse.json({ ok: true, phoneMasked });
    }
    const { data: credentials, error } = await supabase.from("passkey_credentials")
      .select("credential_id").eq("identity_id", user.identityId);
    if (error) throw error;
    if (!credentials?.length) return NextResponse.json({ error: "登録済みのPasskeyがありません" }, { status: 409 });
    const options = await generateAuthenticationOptions({ rpID: rpConfig().rpID, userVerification: "required",
      allowCredentials: credentials.map((c) => ({ id: c.credential_id as string })) });
    const challengeToken = await createChallengeToken({ challenge: options.challenge, purpose: "reauth",
      identityId: user.identityId, sessionHash: sessionFingerprint(req) });
    return NextResponse.json({ options, challengeToken });
  } catch {
    return NextResponse.json({ error: "本人確認を開始できませんでした。時間をおいてお試しください" }, { status: 503 });
  }
}
