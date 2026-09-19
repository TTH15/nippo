import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/server/db/client";
import { signToken, resolveCapabilities } from "@/server/auth";
import { getCompany } from "@/config/companies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { loginType, companyCode, pin, adminCode, password } = body;
    const envCompany = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

    // 古いアプリからのPIN認証も閉じる。本人検索やハッシュ比較を行わない。
    if (loginType === "driver") {
      return NextResponse.json({ error: "PINログインは終了しました。Passkeyまたは電話番号でログインしてください", code: "PIN_LOGIN_RETIRED" }, { status: 410 });
    }

    // 管理者ログイン: 管理者コード（会社コード3文字+管理者番号） + パスワード
    if (loginType === "admin") {
      const rawAdminCode =
        typeof adminCode === "string" && adminCode
          ? adminCode
          : typeof companyCode === "string" && companyCode
            ? companyCode
            : "";
      const rawPassword =
        typeof password === "string" && password
          ? password
          : typeof pin === "string" && pin
            ? pin
            : "";

      if (!rawAdminCode || typeof rawAdminCode !== "string") {
        return NextResponse.json({ error: "管理者コードを入力してください" }, { status: 400 });
      }
      if (!rawPassword) {
        return NextResponse.json({ error: "パスワードを入力してください" }, { status: 400 });
      }

      const full = rawAdminCode.toUpperCase();
      if (!/^[A-Z]{3}\d{4,8}$/.test(full)) {
        return NextResponse.json({ error: "管理者コードの形式が正しくありません" }, { status: 400 });
      }
      if (rawPassword.length < 8) {
        return NextResponse.json({ error: "パスワードは8文字以上で入力してください" }, { status: 400 });
      }

      const code = full.slice(0, 3);
      if (envCompany.code && envCompany.code.length === 3 && code !== envCompany.code) {
        return NextResponse.json({ error: "無効な管理者コードです" }, { status: 401 });
      }

      // §2-6: ロール名でハードコード判定せず、capability で「運営アカウントか」を判定する。
      // これにより ACCOUNTING や org が作ったカスタムロールも（管理権限を1つでも持てば）ログインできる。
      const { data: admin, error } = await supabase
        .from("drivers") // tenant-scope-ok: ログイン前は org 文脈が無い。driver_code + company_code で本人を特定する
        .select("id, name, role, role_id, company_code, driver_code, pin_hash, identity_id, org_id, status, token_version")
        .eq("driver_code", full)
        .eq("company_code", code)
        .single();

      if (error || !admin) {
        return NextResponse.json({ error: "無効な管理者コードです" }, { status: 401 });
      }
      if (!admin.pin_hash) {
        return NextResponse.json({ error: "管理者の設定が不完全です" }, { status: 500 });
      }

      const match = await bcrypt.compare(rawPassword, admin.pin_hash);
      if (!match) {
        return NextResponse.json({ error: "パスワードが正しくありません" }, { status: 401 });
      }

      // 管理権限の判定: capability を1つでも持てば運営アカウント（純ドライバー＝0個は不可）。
      const adminCaps = await resolveCapabilities(admin.id, admin.role);
      if (adminCaps.size === 0) {
        return NextResponse.json({ error: "このアカウントには管理権限がありません" }, { status: 403 });
      }

      // Phase 7a: membership status の適用。active 以外はログイン不可。
      if (admin.status && admin.status !== "active") {
        const msg =
          admin.status === "pending"
            ? "アカウントは承認待ちです。運営の承認をお待ちください。"
            : "このアカウントは利用できません。運営にお問い合わせください。";
        return NextResponse.json({ error: msg }, { status: 403 });
      }

      const token = await signToken({
        driverId: admin.id,
        role: admin.role,
        companyCode: admin.company_code || envCompany.code,
        identityId: admin.identity_id,
        orgId: admin.org_id,
        tokenVersion: admin.token_version,
      });

      return NextResponse.json({
        token,
        driver: {
          id: admin.id,
          name: admin.name,
          role: admin.role,
          companyCode: admin.company_code,
          capabilities: Array.from(adminCaps),
        },
      });
    }

    return NextResponse.json({ error: "Invalid login type" }, { status: 400 });
  } catch (err) {
    console.error("Login error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Missing JWT_SECRET")) {
      return NextResponse.json(
        { error: "JWT_SECRET が未設定です（Vercelの環境変数に設定してください）" },
        { status: 500 },
      );
    }
    if (msg.includes("Missing SUPABASE_URL") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercelの環境変数に設定してください）" },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
