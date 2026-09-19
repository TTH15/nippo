import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";
import { toE164JP } from "@/server/otp/phone";
import { checkOtp } from "@/server/otp/twilio";

import { phoneEnrollment } from "@/server/auth/phoneEnrollment";
import { issueRecentAuthGrant } from "@/server/auth/recentAuth";

export const dynamic = "force-dynamic";

// ============================================================
// ログイン中ドライバーが自分の電話番号をSMS OTPで検証する。
// join フローを経ていない既存ドライバーは identities.phone_verified_at が未設定のままで、
// Passkeyログイン・SMS OTPリカバリー(/login/recover)が使えない。それを本人が今すぐ埋められるようにする。
// 送信先は保存済みの本人番号に限定する。
// ============================================================

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) {
    return NextResponse.json(
      { error: "identityが未設定のため電話番号を確認できません" },
      { status: 400 },
    );
  }

  let enrollment;
  try { enrollment = await phoneEnrollment(user, identityId); }
  catch { return NextResponse.json({ error: "登録済みの電話番号を確認できませんでした" }, { status: 503 }); }
  const { identity: existingIdentity, phone: trustedPhone } = enrollment;

  if (existingIdentity?.phone_verified_at) {
    return NextResponse.json(
      { error: "既に電話番号が確認済みです。変更する場合は運営にご連絡ください" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const phone = body?.phone === undefined ? trustedPhone : toE164JP(typeof body.phone === "string" ? body.phone : "");
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!phone) {
    return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
  }
  if (!trustedPhone || phone !== trustedPhone) {
    return NextResponse.json({ error: "登録済みの電話番号を入力してください。番号の変更は運営にご連絡ください" }, { status: 403 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "認証コードを入力してください" }, { status: 400 });
  }

  let approved;
  try { approved = await checkOtp(phone, code); }
  catch { return NextResponse.json({ error: "SMSの確認に失敗しました" }, { status: 503 }); }
  if (!approved) {
    return NextResponse.json({ error: "認証コードが正しくありません" }, { status: 400 });
  }

  const update = supabase
    .from("identities")
    .update({ phone, phone_verified_at: new Date().toISOString() })
    .eq("id", identityId).is("phone_verified_at", null);
  const { data: updated, error: updateError } = await (existingIdentity.phone === null
    ? update.is("phone", null) : update.eq("phone", existingIdentity.phone)).select("id").maybeSingle();

  if (updateError) {
    if (updateError.code === "23505") {
      return NextResponse.json(
        { error: "この電話番号は既に別のアカウントで使用されています" },
        { status: 409 },
      );
    }
    console.error("[Phone verify] identities update error:", updateError);
    return NextResponse.json({ error: "電話番号の更新に失敗しました" }, { status: 500 });
  }

  if (!updated) return NextResponse.json({ error: "電話番号の設定が変わりました。読み込み直してください" }, { status: 409 });

  // membership側の表示用電話番号も同期しておく（プロフィール表示に使う drivers.phone）。
  // tenant-scope-ok: SMS OTP検証後、requireAuth由来の本人user.driverIdだけを同期
  await supabase.from("drivers").update({ phone }).eq("id", user.driverId).eq("org_id", user.orgId);

  // SMS確認直後のPasskey登録で二重にSMSを求めない。証明は同一セッションに限定。
  try {
    const reauthToken = await issueRecentAuthGrant(req, { ...user, identityId });
    return NextResponse.json({ ok: true, phone, reauthToken }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "SMS確認は完了しました。ログイン設定を読み込み直してください" }, { status: 503 });
  }
}
