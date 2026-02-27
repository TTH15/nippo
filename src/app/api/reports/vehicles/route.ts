import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: ドライバーが選択可能な車両一覧（vehicle_driversで紐づいた車両のみ）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const { data: assignedVehicleIds, error: prefErr } = await supabase
    .from("vehicle_drivers")
    .select("vehicle_id")
    .eq("driver_id", user.driverId);

  if (prefErr) {
    console.error(prefErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const ids = (assignedVehicleIds ?? []).map((r) => r.vehicle_id);

  // 紐付け車両がない場合は空配列を返す（全車両は返さない）
  if (ids.length === 0) {
    return NextResponse.json({ vehicles: [], driverId: user.driverId, vehicleIds: [] });
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage")
    .in("id", ids)
    .order("manufacturer")
    .order("brand");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ vehicles: vehicles ?? [], driverId: user.driverId, vehicleIds: ids });
}
