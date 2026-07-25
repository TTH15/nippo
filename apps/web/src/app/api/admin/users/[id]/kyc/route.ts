import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError, getCapabilities } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { signKyc } from "@/server/kyc/storage";

export const dynamic = "force-dynamic";

// 本人確認レビュー用: 当該ドライバーの免許/顔の署名URL＋本登録項目を返す。
// 顔・免許（PII）の閲覧は can_view_pii を持つロールのみ（§2-6。既定では ADMIN のみ＝
// ADMIN_VIEWER/ACCOUNTING は不可。設計 §2 PII ガードレール③に整合）。org ガードで他社は 404。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_view_pii");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: driverId } = await params;

  const { data: driver } = await supabase
    .from("drivers")
    .select(
      "id, name, identity_id, postal_code, address, address_matches_license, bank_name, bank_no, bank_holder, kyc_verified_at",
    )
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) {
    return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
  }

  const { data: identity } = driver.identity_id
    ? await supabase
        .from("identities")
        .select("license_photo_path, face_photo_path, license_expiry, dob, name_kana")
        .eq("id", driver.identity_id)
        .maybeSingle()
    : { data: null };

  const licenseUrl = identity?.license_photo_path ? await signKyc(supabase, identity.license_photo_path) : null;
  const faceUrl = identity?.face_photo_path ? await signKyc(supabase, identity.face_photo_path) : null;

  // §2-6: 口座は can_view_bank_accounts を持つ場合のみ開示（PII 閲覧者でも口座は別ゲート）。
  const caps = await getCapabilities(user);
  const showBank = caps.has("can_view_bank_accounts");

  return NextResponse.json({
    name: driver.name,
    nameKana: identity?.name_kana ?? "",
    licenseUrl,
    faceUrl,
    licenseExpiry: identity?.license_expiry ?? "",
    dob: identity?.dob ?? "",
    postalCode: driver.postal_code ?? "",
    address: driver.address ?? "",
    addressMatchesLicense: (driver.address_matches_license as boolean | null) ?? null,
    bankName: showBank ? (driver.bank_name ?? "") : "",
    bankNo: showBank ? (driver.bank_no ?? "") : "",
    bankHolder: showBank ? (driver.bank_holder ?? "") : "",
    kycVerified: !!driver.kyc_verified_at,
  });
}
