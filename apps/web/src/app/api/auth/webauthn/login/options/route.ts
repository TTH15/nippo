import { NextResponse } from "next/server";
import { generateAuthenticationOptions, createChallengeToken, rpConfig } from "@/server/auth/webauthn";

export const dynamic = "force-dynamic";

export async function POST() {
  const { rpID } = rpConfig();

  // allowCredentials を渡さない = discoverable credential（ドライバーコード入力不要のログイン）
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  const challengeToken = await createChallengeToken({
    challenge: options.challenge,
    purpose: "login",
  });

  return NextResponse.json({ options, challengeToken });
}
