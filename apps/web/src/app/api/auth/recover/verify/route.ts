import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";
import { checkOtp } from "@/server/otp/twilio";
import {
  resolveActiveDriverByIdentity,
  describeIdentityLoginFailure,
  issueDriverSession,
} from "@/server/identity";

export const dynamic = "force-dynamic";

// ============================================================
// 公開・アカウント復旧API。認証不要。
// Passkey/PINを共に失った端末変更時などに、検証済み電話番号のSMS OTPで本人確認し、
// 通常ログインと同じセッションを発行する（設計: docs/platform-design.md §2-1 端末紛失リカバリ）。
// OTP送信は既存の公開 POST /api/otp/send をそのまま使う。
// ============================================================

export async function POST(req: NextRequest) {
  try {
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

    // 検証済みの電話番号を持つ identity のみ対象（未検証の legacy 行は対象外）。
    const { data: identity, error: identityError } = await supabase
      .from("identities")
      .select("id")
      .eq("phone", phone)
      .not("phone_verified_at", "is", null)
      .order("phone_verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (identityError || !identity) {
      return NextResponse.json(
        { error: "この電話番号で登録されたアカウントが見つかりませんでした" },
        { status: 401 },
      );
    }

    const resolved = await resolveActiveDriverByIdentity(identity.id);
    if ("error" in resolved) {
      const failure = await describeIdentityLoginFailure(identity.id, resolved.error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    return NextResponse.json(await issueDriverSession(resolved.driver));
  } catch (err) {
    console.error("[Recover] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
