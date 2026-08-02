import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { KYC_BUCKET } from "@/server/kyc/storage";
import { isAnthropicConfigured } from "@/server/ai/client";
import { extractLicense, compareLicense } from "@/server/ai/kycVerify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// KYC 承認支援: 免許証写真を AI で読み取り、申請内容（氏名・生年月日・有効期限・住所）
// との一致/不一致を返す。判定は参考情報で、承認の最終確定は運営（目視）が行う。
// 免許証画像（PII）を扱うため can_view_pii ゲート。実行のたびに AI を呼ぶ（結果は保存しない）。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_view_pii");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id: driverId } = await params;

  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "AI が設定されていません（ANTHROPIC_API_KEY）" }, { status: 503 });
  }

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, name, address, identity_id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) {
    return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
  }

  const { data: identity } = driver.identity_id
    ? await supabase
        .from("identities")
        .select("license_photo_path, license_expiry, dob")
        .eq("id", driver.identity_id)
        .maybeSingle()
    : { data: null };
  if (!identity?.license_photo_path) {
    return NextResponse.json({ error: "免許証が未提出です" }, { status: 400 });
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from(KYC_BUCKET)
    .download(identity.license_photo_path);
  if (dlErr || !blob) {
    console.error("[admin/users/kyc-check] download error", dlErr);
    return NextResponse.json({ error: "免許証画像を取得できませんでした" }, { status: 500 });
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = identity.license_photo_path.endsWith(".png") ? "image/png" : "image/jpeg";
    const extraction = await extractLicense(bytes, mime);
    if (!extraction.isDriversLicense) {
      return NextResponse.json({
        isDriversLicense: false,
        checks: [],
        warnings: ["提出された画像が運転免許証ではない可能性があります", ...extraction.warnings],
      });
    }
    const checks = compareLicense(extraction, {
      name: driver.name ?? "",
      dob: (identity.dob as string | null) ?? "",
      expiry: (identity.license_expiry as string | null) ?? "",
      address: (driver.address as string | null) ?? "",
    });
    return NextResponse.json({ isDriversLicense: true, checks, warnings: extraction.warnings });
  } catch (err) {
    console.error("[admin/users/kyc-check] error", err);
    const message = err instanceof Error ? err.message : "AI 照合に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
