import { NextRequest, NextResponse } from "next/server";
import { toE164JP } from "@/server/otp/phone";
import { sendOtp } from "@/server/otp/twilio";

export const dynamic = "force-dynamic";

// 公開: 電話番号に SMS 認証コードを送る（仮登録用）。レート制限は Twilio Verify 任せ。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw = typeof body.phone === "string" ? body.phone : "";
    const phone = toE164JP(raw);
    if (!phone) {
      return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
    }
    await sendOtp(phone);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[otp/send]", err);
    const msg = err instanceof Error && err.message.includes("Twilio 未設定")
      ? "SMS 設定が未完了です（運営にお問い合わせください）"
      : "認証コードの送信に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
