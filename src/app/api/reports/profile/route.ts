import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** ログイン中ドライバーのプロフィール（配達受託者控のオーバーレイ用） */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const { data: driver, error } = await supabase
    .from("drivers")
    .select("name, office_code, driver_code")
    .eq("id", user.driverId)
    .single();

  if (error || !driver) {
    return NextResponse.json({ error: "Driver not found" }, { status: 404 });
  }

  return NextResponse.json({
    name: driver.name ?? "",
    officeCode: driver.office_code ?? "",
    driverCode: driver.driver_code ?? "",
  });
}
