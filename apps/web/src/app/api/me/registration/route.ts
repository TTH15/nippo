import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// GET: 本登録の現在状態（プリフィル＋完了判定）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ error: "アカウント情報が不完全です" }, { status: 400 });

  const { data: identity } = await supabase
    .from("identities")
    .select("name, dob, license_expiry, license_photo_path, face_photo_path")
    .eq("id", identityId)
    .single();
  const { data: driver } = await supabase
    .from("drivers")
    .select("postal_code, address, address_matches_license, bank_name, bank_no, bank_holder, kyc_verified_at")
    .eq("id", user.driverId)
    .single();

  const hasLicensePhoto = !!identity?.license_photo_path;
  const hasFacePhoto = !!identity?.face_photo_path;
  // 口座は本登録の完了条件から除外（2026-07-25）。初回の報酬支払いまでに
  // アプリ（マイページ）で登録してもらう。POST での受け付け・保存は従来どおり。
  const complete =
    hasLicensePhoto &&
    hasFacePhoto &&
    !!identity?.license_expiry &&
    !!driver?.postal_code &&
    !!driver?.address;

  return NextResponse.json({
    name: identity?.name ?? "",
    dob: identity?.dob ?? "",
    licenseExpiry: identity?.license_expiry ?? "",
    hasLicensePhoto,
    hasFacePhoto,
    postalCode: driver?.postal_code ?? "",
    address: driver?.address ?? "",
    addressMatchesLicense: (driver?.address_matches_license as boolean | null) ?? null,
    bankName: driver?.bank_name ?? "",
    bankNo: driver?.bank_no ?? "",
    bankHolder: driver?.bank_holder ?? "",
    complete,
    kycVerified: !!driver?.kyc_verified_at,
  });
}

// POST: 本登録のテキスト項目を「部分更新」で保存（ウィザードのステップごと）。
// body に含まれた項目だけ更新する。完了判定は GET の complete に委ねる。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const idUpdate: Record<string, unknown> = {};
    const drvUpdate: Record<string, unknown> = {};

    if (body.licenseExpiry !== undefined) {
      const v = str(body.licenseExpiry);
      if (v && !DATE_RE.test(v)) {
        return NextResponse.json({ error: "免許有効期限は YYYY-MM-DD で入力してください" }, { status: 400 });
      }
      idUpdate.license_expiry = v || null;
      drvUpdate.license_expiry_date = v || null; // 旧モデル互換（admin の license badge 等）
    }
    if (body.dob !== undefined) {
      const v = str(body.dob);
      if (v && !DATE_RE.test(v)) {
        return NextResponse.json({ error: "生年月日は YYYY-MM-DD で入力してください" }, { status: 400 });
      }
      idUpdate.dob = v || null;
    }
    if (body.postalCode !== undefined) drvUpdate.postal_code = str(body.postalCode) || null;
    if (body.address !== undefined) drvUpdate.address = str(body.address) || null;
    // 本人申告「住所は免許証記載と同じ」（migration 117）。承認時の運営確認材料。
    if (body.addressMatchesLicense !== undefined) {
      drvUpdate.address_matches_license = body.addressMatchesLicense === true;
    }
    if (body.bankName !== undefined) drvUpdate.bank_name = str(body.bankName) || null;
    if (body.bankNo !== undefined) drvUpdate.bank_no = str(body.bankNo) || null;
    if (body.bankHolder !== undefined) drvUpdate.bank_holder = str(body.bankHolder) || null;

    const identityId = await resolveIdentityId(user);
    if (!identityId) return NextResponse.json({ error: "アカウント情報が不完全です" }, { status: 400 });

    if (Object.keys(idUpdate).length > 0) {
      const { error } = await supabase.from("identities").update(idUpdate).eq("id", identityId);
      if (error) {
        console.error("[registration] identity update", error);
        return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
      }
    }
    if (Object.keys(drvUpdate).length > 0) {
      const { error } = await supabase.from("drivers").update(drvUpdate).eq("id", user.driverId);
      if (error) {
        console.error("[registration] driver update", error);
        return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[registration]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
