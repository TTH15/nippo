import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { signKyc } from "@/server/kyc/storage";

export const dynamic = "force-dynamic";

// 本人確認レビュー用: 当該ドライバーの免許/顔の署名URL＋本登録項目を返す。
// 顔・免許の閲覧は ADMIN/ADMIN_VIEWER のみ（最小権限）。org ガードで他社は 404。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: driverId } = await params;

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, name, identity_id, postal_code, address, bank_name, bank_no, bank_holder, kyc_verified_at")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) {
    return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
  }

  const { data: identity } = driver.identity_id
    ? await supabase
        .from("identities")
        .select("license_photo_path, face_photo_path, license_expiry, dob")
        .eq("id", driver.identity_id)
        .maybeSingle()
    : { data: null };

  const licenseUrl = identity?.license_photo_path ? await signKyc(supabase, identity.license_photo_path) : null;
  const faceUrl = identity?.face_photo_path ? await signKyc(supabase, identity.face_photo_path) : null;

  return NextResponse.json({
    name: driver.name,
    licenseUrl,
    faceUrl,
    licenseExpiry: identity?.license_expiry ?? "",
    dob: identity?.dob ?? "",
    postalCode: driver.postal_code ?? "",
    address: driver.address ?? "",
    bankName: driver.bank_name ?? "",
    bankNo: driver.bank_no ?? "",
    bankHolder: driver.bank_holder ?? "",
    kycVerified: !!driver.kyc_verified_at,
  });
}
