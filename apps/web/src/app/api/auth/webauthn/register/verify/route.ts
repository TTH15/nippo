import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import {
  verifyRegistrationResponse,
  verifyChallengeToken,
  publicKeyToBytea,
  rpConfig,
} from "@/server/auth/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  if (!user.identityId) {
    return NextResponse.json(
      { error: "identityが未設定のためPasskeyを登録できません" },
      { status: 400 },
    );
  }

  const body = await req.json();
  const { response, challengeToken, name } = body ?? {};
  if (!response || typeof challengeToken !== "string") {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  let challenge: string;
  try {
    const verifiedToken = await verifyChallengeToken(challengeToken, "register");
    if (verifiedToken.identityId !== user.identityId) {
      return NextResponse.json({ error: "本人確認に失敗しました" }, { status: 401 });
    }
    challenge = verifiedToken.challenge;
  } catch {
    return NextResponse.json(
      { error: "セッションの有効期限が切れました。もう一度お試しください" },
      { status: 401 },
    );
  }

  const { rpID, origin } = rpConfig();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    console.error("[Passkey] register verify error:", err);
    return NextResponse.json({ error: "Passkeyの検証に失敗しました" }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Passkeyの検証に失敗しました" }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const { error: insertError } = await supabase.from("passkey_credentials").insert({
    identity_id: user.identityId,
    credential_id: credential.id,
    public_key: publicKeyToBytea(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null,
  });

  if (insertError) {
    console.error("[Passkey] insert error:", insertError);
    return NextResponse.json({ error: "Passkeyの保存に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
