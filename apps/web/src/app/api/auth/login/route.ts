import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/server/db/client";
import { signToken, resolveCapabilities } from "@/server/auth";
import { getCompany } from "@/config/companies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { loginType, companyCode, pin, driverCode, adminCode, password } = body;
    const envCompany = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

    // ドライバーログイン: ドライバーコード（9桁）+ PIN でログイン
    if (loginType === "driver") {
      if (!driverCode || typeof driverCode !== "string" || driverCode.length !== 9) {
        return NextResponse.json({ error: "ドライバーコードは9桁で入力してください" }, { status: 400 });
      }
      if (!pin || typeof pin !== "string" || pin.length !== 6) {
        return NextResponse.json(
          { error: "PINは6桁の数字で入力してください" },
          { status: 400 },
        );
      }

      const code = driverCode.toUpperCase();

      console.log("[Login] Driver code:", code);

      // ドライバーコードでドライバーを検索（従来: drivers.driver_code / 追加: driver_identities）
      let driver: {
        id: string;
        name: string;
        role: string;
        company_code: string | null;
        office_code: string | null;
        driver_code: string | null;
        pin_hash: string | null;
        identity_id: string | null;
        org_id: string | null;
        status: string | null;
      } | null = null;

      const { data: byDriverRow, error: err1 } = await supabase
        .from("drivers") // tenant-scope-ok: ログイン前は org 文脈が無い。driver_code から org を決める側の問い合わせ
        .select("id, name, role, company_code, office_code, driver_code, pin_hash, identity_id, org_id, status")
        .eq("driver_code", code)
        .maybeSingle();

      if (err1 && err1.code !== "PGRST116") {
        console.error("[Login] Database error:", err1);
        if (err1.message?.includes("column") || err1.code === "42703") {
          return NextResponse.json({
            error: "データベースの設定が完了していません。マイグレーションを実行してください。",
          }, { status: 500 });
        }
        return NextResponse.json({ error: `データベースエラー: ${err1.message}` }, { status: 500 });
      }

      if (byDriverRow) {
        driver = byDriverRow;
      } else {
        const { data: idRow, error: err2 } = await supabase
          .from("driver_identities")
          .select("driver_id")
          .eq("driver_code", code)
          .maybeSingle();

        if (err2 && err2.code !== "PGRST116") {
          console.error("[Login] driver_identities error:", err2);
          return NextResponse.json({ error: `データベースエラー: ${err2.message}` }, { status: 500 });
        }

        if (idRow?.driver_id) {
          const { data: d2, error: err3 } = await supabase
            .from("drivers")
            .select("id, name, role, company_code, office_code, driver_code, pin_hash, identity_id, org_id, status")
            .eq("id", idRow.driver_id)
            .single();
          if (!err3 && d2) driver = d2;
        }
      }

      console.log("[Login] Driver query result:", { driver, code });

      if (!driver) {
        return NextResponse.json({
          error: `ドライバーコード "${code}" が見つかりませんでした。正しいコードを入力してください。`,
        }, { status: 401 });
      }

      if (!driver.pin_hash) {
        console.error("[Login] Driver has no PIN hash");
        return NextResponse.json({ 
          error: "ドライバーの設定が不完全です。管理者に連絡してください。" 
        }, { status: 500 });
      }

      // PINは、初期値としてドライバーコードの数字6桁を設定し、その後変更可能
      const match = await bcrypt.compare(pin, driver.pin_hash);
      console.log("[Login] PIN match:", match);
      if (!match) {
        return NextResponse.json({
          error: "PINが正しくありません。"
        }, { status: 401 });
      }

      // Phase 7a: membership status の適用。active 以外はログイン不可。
      if (driver.status && driver.status !== "active") {
        const msg =
          driver.status === "pending"
            ? "アカウントは承認待ちです。運営の承認をお待ちください。"
            : "このアカウントは利用できません。運営にお問い合わせください。";
        return NextResponse.json({ error: msg }, { status: 403 });
      }

      const token = await signToken({
        driverId: driver.id,
        role: driver.role as "DRIVER",
        companyCode: driver.company_code || envCompany.code,
        identityId: driver.identity_id,
        orgId: driver.org_id,
      });

      const { data: loginIdentity } = await supabase
        .from("driver_identities")
        .select("driver_code, office_code")
        .eq("driver_code", code)
        .maybeSingle();

      const driverCaps = await resolveCapabilities(driver.id, driver.role);

      return NextResponse.json({
        token,
        driver: {
          id: driver.id,
          name: driver.name,
          role: driver.role,
          companyCode: driver.company_code,
          officeCode: loginIdentity?.office_code ?? driver.office_code ?? "",
          driverCode: loginIdentity?.driver_code ?? driver.driver_code ?? "",
          capabilities: Array.from(driverCaps),
        },
      });
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
        .select("id, name, role, role_id, company_code, driver_code, pin_hash, identity_id, org_id, status")
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
