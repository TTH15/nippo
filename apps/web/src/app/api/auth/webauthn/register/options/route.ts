import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { generateRegistrationOptions, createChallengeToken, rpConfig } from "@/server/auth/webauthn";

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

  const { data: driver } = await supabase
    .from("drivers")
    .select("name")
    .eq("id", user.driverId)
    .maybeSingle();

  const { data: existing } = await supabase
    .from("passkey_credentials")
    .select("credential_id, transports")
    .eq("identity_id", user.identityId);

  const { rpID, rpName } = rpConfig();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(user.identityId),
    // OS/ブラウザのPasskey選択UIに出るラベル。ドライバーコードだと無機質なので氏名を使う。
    userName: driver?.name || "ドライバー",
    userDisplayName: driver?.name || "ドライバー",
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  const challengeToken = await createChallengeToken({
    challenge: options.challenge,
    purpose: "register",
    identityId: user.identityId,
  });

  return NextResponse.json({ options, challengeToken });
}
