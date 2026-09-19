import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { reauthIdentity } from "@/server/auth/reauthIdentity";
import { issueRecentAuthGrant, sessionFingerprint } from "@/server/auth/recentAuth";
import { checkOtp } from "@/server/otp/twilio";
import { supabase } from "@/server/db/client";
import { verifyAuthenticationResponse, verifyChallengeToken, consumeChallengeToken, byteaToPublicKey, rpConfig } from "@/server/auth/webauthn";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (!user.identityId) return NextResponse.json({ error: "本人確認の設定がありません" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const reject = () => NextResponse.json({ error: "本人確認が完了しませんでした。もう一度お試しください" }, { status: 400 });
  try {
    if (body?.method === "sms") {
      if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) return reject();
      const { phone } = await reauthIdentity(user.identityId);
      if (!phone || !await checkOtp(phone, body.code)) return reject();
    } else if (body?.method === "passkey") {
      if (typeof body.challengeToken !== "string" || typeof body.response?.id !== "string") return reject();
      let challenge;
      try { challenge = await verifyChallengeToken(body.challengeToken, "reauth"); } catch { return reject(); }
      if (challenge.identityId !== user.identityId || challenge.sessionHash !== sessionFingerprint(req)) return reject();
      const { data: cred, error } = await supabase.from("passkey_credentials")
        .select("id, credential_id, public_key, counter").eq("identity_id", user.identityId).eq("credential_id", body.response.id).maybeSingle();
      if (error) throw error;
      if (!cred) return reject();
      let verification;
      try {
        const { rpID, origin } = rpConfig();
        verification = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge.challenge,
          expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
          credential: { id: cred.credential_id, publicKey: byteaToPublicKey(cred.public_key), counter: Number(cred.counter) } });
      } catch { return reject(); }
      if (!verification.verified) return reject();
      if (!await consumeChallengeToken(body.challengeToken, "reauth", user.identityId)) return reject();
      const updated = await supabase.from("passkey_credentials").update({ counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString() }).eq("id", cred.id).eq("identity_id", user.identityId).eq("counter", cred.counter).select("id").maybeSingle();
      if (updated.error || !updated.data) throw new Error("Failed to update credential");
    } else { return reject(); }
    return NextResponse.json({ reauthToken: await issueRecentAuthGrant(req, user) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "本人確認を完了できませんでした。時間をおいてお試しください" }, { status: 503 });
  }
}
