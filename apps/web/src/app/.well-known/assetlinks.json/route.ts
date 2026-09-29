import { NextResponse } from "next/server";
import { androidSigningFingerprints } from "@/server/auth/nativeAssociation";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    const fingerprints = androidSigningFingerprints();
    if (!fingerprints.length) throw new Error("Not configured");
    return NextResponse.json([{
      relation: ["delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: "jp.hakotora.app", sha256_cert_fingerprints: fingerprints },
    }], { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
