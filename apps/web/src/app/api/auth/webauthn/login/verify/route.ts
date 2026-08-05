import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import {
  verifyAuthenticationResponse,
  verifyChallengeToken,
  byteaToPublicKey,
  rpConfig,
} from "@/server/auth/webauthn";
import {
  resolveActiveDriverByIdentity,
  describeIdentityLoginFailure,
  issueDriverSession,
} from "@/server/identity";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { response, challengeToken } = body ?? {};
    if (!response || typeof challengeToken !== "string") {
      return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
    }

    let challenge: string;
    try {
      const verifiedToken = await verifyChallengeToken(challengeToken, "login");
      challenge = verifiedToken.challenge;
    } catch {
      return NextResponse.json(
        { error: "セッションの有効期限が切れました。もう一度お試しください" },
        { status: 401 },
      );
    }

    const credentialId = typeof response.id === "string" ? response.id : undefined;
    if (!credentialId) {
      return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
    }

    const { data: cred, error: credError } = await supabase
      .from("passkey_credentials")
      .select("id, identity_id, credential_id, public_key, counter")
      .eq("credential_id", credentialId)
      .maybeSingle();

    if (credError || !cred) {
      return NextResponse.json({ error: "登録されていないPasskeyです" }, { status: 401 });
    }

    const { rpID, origin } = rpConfig();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: cred.credential_id as string,
          publicKey: byteaToPublicKey(cred.public_key as string),
          counter: Number(cred.counter),
        },
      });
    } catch (err) {
      console.error("[Passkey] login verify error:", err);
      return NextResponse.json({ error: "Passkeyの検証に失敗しました" }, { status: 401 });
    }

    if (!verification.verified) {
      return NextResponse.json({ error: "Passkeyの検証に失敗しました" }, { status: 401 });
    }

    await supabase
      .from("passkey_credentials")
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", cred.id);

    const resolved = await resolveActiveDriverByIdentity(cred.identity_id as string);
    if ("error" in resolved) {
      // Passkey 自体は検証できているのに membership 側で弾かれた状態。
      // 招待リンク経由の人は PIN を持たないので「PINでログインして」は案内にならない。
      const failure = await describeIdentityLoginFailure(cred.identity_id as string, resolved.error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    return NextResponse.json(await issueDriverSession(resolved.driver));
  } catch (err) {
    console.error("[Passkey] login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
