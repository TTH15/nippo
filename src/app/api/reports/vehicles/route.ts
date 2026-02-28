import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: ドライバーが選択可能な車両一覧
// DRIVER: 紐付けられた車両のみ
// ADMIN / ADMIN_VIEWER: 全車両
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  // 管理系ロールは全車両
  if (user.role === "ADMIN" || user.role === "ADMIN_VIEWER") {
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select(
        "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, last_oil_change_mileage, oil_change_interval",
      )
      .order("manufacturer")
      .order("brand");

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ vehicles: vehicles ?? [] });
  }

  // DRIVER: vehicle_drivers の紐付けから取得
  const { data: links, error: linksError } = await supabase
    .from("vehicle_drivers")
    .select("vehicle_id")
    .eq("driver_id", user.driverId);

  if (linksError) {
    console.error(linksError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const vehicleIds = Array.from(
    new Set((links ?? []).map((l: { vehicle_id: string }) => l.vehicle_id)),
  );

  if (vehicleIds.length === 0) {
    return NextResponse.json({ vehicles: [] });
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select(
      "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage",
    )
    .in("id", vehicleIds)
    .order("manufacturer")
    .order("brand");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ vehicles: vehicles ?? [] });
}
