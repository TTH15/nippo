import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/server/db/client";
import { signToken } from "@/server/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { loginType, companyCode, pin, driverCode } = body;

    // ドライバーログイン: ドライバーコード（9桁）でログイン
    if (loginType === "driver") {
      if (!driverCode || typeof driverCode !== "string" || driverCode.length !== 9) {
        return NextResponse.json({ error: "ドライバーコードは9桁で入力してください" }, { status: 400 });
      }

      const code = driverCode.toUpperCase();
      const numericPart = code.slice(3); // 数字6桁部分

      console.log("[Login] Driver code:", code, "Numeric part:", numericPart);

      // ドライバーコードでドライバーを検索
      const { data: driver, error } = await supabase
        .from("drivers")
        .select("id, name, role, company_code, driver_code, pin_hash")
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

      // PINは数字6桁部分
      const match = await bcrypt.compare(numericPart, driver.pin_hash);
      console.log("[Login] PIN match:", match, "Comparing:", numericPart);
      if (!match) {
        return NextResponse.json({ 
          error: "PINが正しくありません。ドライバーコードの数字6桁部分を確認してください。" 
        }, { status: 401 });
      }

      const token = await signToken({ 
        driverId: driver.id, 
        role: driver.role,
        companyCode: driver.company_code || "AAA" 
      });

      return NextResponse.json({
        token,
        driver: { 
          id: driver.id, 
          name: driver.name, 
          role: driver.role,
          companyCode: driver.company_code,
          driverCode: driver.driver_code,
        },
      });
    }

    // 管理者ログイン: 会社コード + PIN
    if (loginType === "admin") {
      if (!companyCode || typeof companyCode !== "string" || companyCode.length !== 3) {
        return NextResponse.json({ error: "会社コードは3文字で入力してください" }, { status: 400 });
      }
      if (!pin || typeof pin !== "string") {
        return NextResponse.json({ error: "PINを入力してください" }, { status: 400 });
      }

      const code = companyCode.toUpperCase();

      // 管理者アカウントを検索
      const { data: admin, error } = await supabase
        .from("drivers")
        .select("id, name, role, company_code, pin_hash")
        .eq("company_code", code)
        .eq("role", "ADMIN")
        .not("pin_hash", "is", null)
        .limit(1)
        .single();

      if (error || !admin) {
        return NextResponse.json({ error: "無効な会社コードです" }, { status: 401 });
      }

      const match = await bcrypt.compare(pin, admin.pin_hash!);
      if (!match) {
        return NextResponse.json({ error: "PINが正しくありません" }, { status: 401 });
      }

      const token = await signToken({ 
        driverId: admin.id, 
        role: admin.role,
        companyCode: admin.company_code || "AAA" 
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
