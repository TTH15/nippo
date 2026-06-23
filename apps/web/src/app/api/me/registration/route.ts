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
    .select("postal_code, address, bank_name, bank_no, bank_holder")
    .eq("id", user.driverId)
    .single();

  const hasLicensePhoto = !!identity?.license_photo_path;
  const hasFacePhoto = !!identity?.face_photo_path;
  const complete =
    hasLicensePhoto &&
    hasFacePhoto &&
    !!identity?.license_expiry &&
    !!driver?.postal_code &&
    !!driver?.address &&
    !!driver?.bank_name &&
    !!driver?.bank_no &&
    !!driver?.bank_holder;

  return NextResponse.json({
    name: identity?.name ?? "",
    dob: identity?.dob ?? "",
    licenseExpiry: identity?.license_expiry ?? "",
    hasLicensePhoto,
    hasFacePhoto,
    postalCode: driver?.postal_code ?? "",
    address: driver?.address ?? "",
    bankName: driver?.bank_name ?? "",
    bankNo: driver?.bank_no ?? "",
    bankHolder: driver?.bank_holder ?? "",
    complete,
  });
}

// POST: 本登録のテキスト項目を保存（写真は /photo で別途）。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const dob = str(body.dob);
    const licenseExpiry = str(body.licenseExpiry);
    const postalCode = str(body.postalCode);
    const address = str(body.address);
    const bankName = str(body.bankName);
    const bankNo = str(body.bankNo);
    const bankHolder = str(body.bankHolder);

    if (!DATE_RE.test(licenseExpiry)) {
      return NextResponse.json({ error: "免許有効期限は YYYY-MM-DD で入力してください" }, { status: 400 });
    }
    if (dob && !DATE_RE.test(dob)) {
      return NextResponse.json({ error: "生年月日は YYYY-MM-DD で入力してください" }, { status: 400 });
    }
    if (!postalCode || !address) {
      return NextResponse.json({ error: "住所を入力してください" }, { status: 400 });
    }
    if (!bankName || !bankNo || !bankHolder) {
      return NextResponse.json({ error: "銀行口座を入力してください" }, { status: 400 });
    }

    const identityId = await resolveIdentityId(user);
    if (!identityId) return NextResponse.json({ error: "アカウント情報が不完全です" }, { status: 400 });

    const { error: iErr } = await supabase
      .from("identities")
      .update({ license_expiry: licenseExpiry, dob: dob || null })
      .eq("id", identityId);
    if (iErr) {
      console.error("[registration] identity update", iErr);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }

    const { error: dErr } = await supabase
      .from("drivers")
      .update({
        postal_code: postalCode,
        address,
        bank_name: bankName,
        bank_no: bankNo,
        bank_holder: bankHolder,
        // 旧モデル互換: drivers にも免許期限を保持（admin 一覧の license badge 等）
        license_expiry_date: licenseExpiry,
      })
      .eq("id", user.driverId);
    if (dErr) {
      console.error("[registration] driver update", dErr);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[registration]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
