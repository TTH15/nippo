import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";
import { toE164JP } from "@/server/otp/phone";
import { checkOtp } from "@/server/otp/twilio";

export const dynamic = "force-dynamic";

// ============================================================
// ログイン中ドライバーが自分の電話番号をSMS OTPで検証する。
// join フローを経ていない既存ドライバーは identities.phone_verified_at が未設定のままで、
// Passkeyログイン・SMS OTPリカバリー(/login/recover)が使えない。それを本人が今すぐ埋められるようにする。
// OTP送信は既存の公開 POST /api/otp/send をそのまま使う。
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

  const body = await req.json();
  const phone = toE164JP(typeof body.phone === "string" ? body.phone : "");
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!phone) {
    return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "認証コードを入力してください" }, { status: 400 });
  }

  const approved = await checkOtp(phone, code);
  if (!approved) {
    return NextResponse.json({ error: "認証コードが正しくありません" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("identities")
    .update({ phone, phone_verified_at: new Date().toISOString() })
    .eq("id", identityId);

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

  // membership側の表示用電話番号も同期しておく（プロフィール表示に使う drivers.phone）。
  await supabase.from("drivers").update({ phone }).eq("id", user.driverId);

  return NextResponse.json({ ok: true, phone });
}
