import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { signToken, resolveCapabilities } from "@/server/auth";
import {
  verifyAuthenticationResponse,
  verifyChallengeToken,
  byteaToPublicKey,
  rpConfig,
} from "@/server/auth/webauthn";
import { getCompany } from "@/config/companies";

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

    const { data: drivers, error: driversError } = await supabase
      .from("drivers")
      .select("id, name, role, company_code, office_code, driver_code, identity_id, org_id, status")
      .eq("identity_id", cred.identity_id)
      .eq("status", "active");

    if (driversError || !drivers || drivers.length === 0) {
      return NextResponse.json({ error: "有効なアカウントが見つかりませんでした" }, { status: 401 });
    }
    if (drivers.length > 1) {
      // 複数所属(複数org)のアカウント選択UIは今回のスコープ外。
      return NextResponse.json(
        { error: "複数の所属があるため、Passkeyログインは未対応です。PINでログインしてください" },
        { status: 409 },
      );
    }

    const driver = drivers[0];
    const envCompany = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

    const token = await signToken({
      driverId: driver.id,
      role: driver.role,
      companyCode: driver.company_code || envCompany.code,
      identityId: driver.identity_id,
      orgId: driver.org_id,
    });

    const driverCaps = await resolveCapabilities(driver.id, driver.role);

    return NextResponse.json({
      token,
      driver: {
        id: driver.id,
        name: driver.name,
        role: driver.role,
        companyCode: driver.company_code,
        officeCode: driver.office_code ?? "",
        driverCode: driver.driver_code ?? "",
        capabilities: Array.from(driverCaps),
      },
    });
  } catch (err) {
    console.error("[Passkey] login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
