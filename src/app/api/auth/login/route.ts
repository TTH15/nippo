import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/server/db/client";
import { signToken } from "@/server/auth";
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

      // ドライバーコードでドライバーを検索
      const { data: driver, error } = await supabase
        .from("drivers")
        .select("id, name, role, company_code, office_code, driver_code, pin_hash")
        .eq("driver_code", code)
        .eq("role", "DRIVER")
        .single();

      console.log("[Login] Driver query result:", { driver, error, code });

      if (error) {
        console.error("[Login] Database error:", error);
        // カラムが存在しない場合のエラーを確認
        if (error.message?.includes("column") || error.code === "42703") {
          return NextResponse.json({ 
            error: "データベースの設定が完了していません。マイグレーションを実行してください。" 
          }, { status: 500 });
        }
        // PGRST116: No rows returned (single() が失敗)
        if (error.code === "PGRST116") {
          return NextResponse.json({ 
            error: `ドライバーコード "${code}" が見つかりませんでした。正しいコードを入力してください。` 
          }, { status: 401 });
        }
        return NextResponse.json({ 
          error: `データベースエラー: ${error.message}` 
        }, { status: 500 });
      }

      if (!driver) {
        console.log("[Login] No driver found with code:", code);
        return NextResponse.json({ 
          error: `ドライバーコード "${code}" が見つかりませんでした。` 
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

      const token = await signToken({ 
        driverId: driver.id, 
        role: driver.role,
        companyCode: driver.company_code || envCompany.code, 
      });

      return NextResponse.json({
        token,
        driver: { 
          id: driver.id, 
          name: driver.name, 
          role: driver.role,
          companyCode: driver.company_code,
          officeCode: driver.office_code ?? "",
          driverCode: driver.driver_code ?? "",
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

      const { data: admin, error } = await supabase
        .from("drivers")
        .select("id, name, role, company_code, driver_code, pin_hash")
        .eq("driver_code", full)
        .eq("company_code", code)
        .in("role", ["ADMIN", "ADMIN_VIEWER"])
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

      const token = await signToken({ 
        driverId: admin.id, 
        role: admin.role,
        companyCode: admin.company_code || envCompany.code, 
      });

      return NextResponse.json({
        token,
        driver: { 
          id: admin.id, 
          name: admin.name, 
          role: admin.role,
          companyCode: admin.company_code,
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
