import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

// GET: 全ドライバー一覧（コース情報含む）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  // 同じ会社コードのドライバーのみ取得
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select(`
      id, name, role, company_code, office_code, driver_code, created_at,
      driver_courses (
        course_id,
        courses (id, name, color)
      )
    `)
    .eq("company_code", user.companyCode)
    .order("name");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ drivers });
}

// POST: 新規ドライバー追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { name, officeCode, driverCode, companyCode, courseIds = [] } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
    }
    if (!officeCode || !/^\d{6}$/.test(officeCode)) {
      return NextResponse.json({ error: "事業所コードは6桁の数字で入力してください" }, { status: 400 });
    }
    if (!driverCode || !/^[A-Z]{3}\d{6}$/.test(driverCode)) {
      return NextResponse.json({ error: "ドライバーコードの形式が正しくありません" }, { status: 400 });
    }

    // ドライバーコードの会社部分が管理者の会社と一致するか確認
    const codeCompany = driverCode.slice(0, 3);
    if (codeCompany !== user.companyCode) {
      return NextResponse.json({ error: "会社コードが一致しません" }, { status: 400 });
    }

    // ドライバーコードの数字部分をPINとしてハッシュ化
    const pinPart = driverCode.slice(3);
    const pinHash = await bcrypt.hash(pinPart, 10);

    // Insert driver
    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .insert({ 
        name: name.trim(), 
        role: "DRIVER", 
        pin_hash: pinHash,
        company_code: companyCode || user.companyCode,
        office_code: officeCode,
        driver_code: driverCode.toUpperCase(),
      })
      .select()
      .single();

    if (dErr) {
      console.error(dErr);
      if (dErr.code === "23505") {
        return NextResponse.json({ error: "このドライバーコードは既に使用されています" }, { status: 400 });
      }
      return NextResponse.json({ error: dErr.message }, { status: 500 });
    }

    // Insert course associations
    if (courseIds.length > 0) {
      const courseLinks = courseIds.map((cid: string) => ({
        driver_id: driver.id,
        course_id: cid,
      }));
      await supabase.from("driver_courses").insert(courseLinks);
    }

    return NextResponse.json({ driver });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
