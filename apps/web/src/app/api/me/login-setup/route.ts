import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { phoneEnrollment } from "@/server/auth/phoneEnrollment";
import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";

export const dynamic = "force-dynamic";

/** 日報の本人向け案内。取得失敗を未登録・登録済みのどちらにも置き換えない。 */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  if (!user.identityId) return NextResponse.json({ error: "ログイン設定を運営にご確認ください" }, { status: 400 });
  try {
    const [{ identity, phone }, { count, error }] = await Promise.all([
      phoneEnrollment(user, user.identityId),
      supabase.from("passkey_credentials").select("id", { count: "exact", head: true }).eq("identity_id", user.identityId),
    ]);
    if (error || count === null) throw new Error("Failed to read credentials");
    return NextResponse.json({
      phoneVerified: !!identity.phone_verified_at && !!toE164JP(identity.phone ?? ""),
      phoneMasked: phone ? `下4桁 ${phone.slice(-4)}` : null,
      hasPasskey: count > 0,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ログイン設定を読み込めませんでした。もう一度お試しください" }, { status: 503 });
  }
}
