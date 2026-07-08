import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";
import { toE164JP } from "@/server/otp/phone";
import { sendOtp } from "@/server/otp/twilio";

export const dynamic = "force-dynamic";

// ============================================================
// マイページの「電話番号の確認」専用の送信口。公開の POST /api/otp/send と違い、
// 既に identities.phone_verified_at が設定済みなら送信自体を拒否する
// （認証済みの番号へドライバーが何度も送れるとTwilioのクレジットを無駄に消費するため）。
// 番号を変え直したい場合は運営が一度紐付けを解除してから再度ここを叩く。
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

  const { data: identityRow } = await supabase
    .from("identities")
    .select("phone_verified_at")
    .eq("id", identityId)
    .maybeSingle();

  if (identityRow?.phone_verified_at) {
    return NextResponse.json(
      { error: "既に電話番号が確認済みです。変更する場合は運営にご連絡ください" },
      { status: 409 },
    );
  }

  const body = await req.json();
  const phone = toE164JP(typeof body.phone === "string" ? body.phone : "");
  if (!phone) {
    return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
  }

  try {
    await sendOtp(phone);
  } catch (err) {
    console.error("[Phone send] error:", err);
    const msg = err instanceof Error && err.message.includes("Twilio 未設定")
      ? "SMS 設定が未完了です（運営にお問い合わせください）"
      : "認証コードの送信に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
