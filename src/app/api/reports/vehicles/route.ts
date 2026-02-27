import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: ドライバーが選択可能な車両一覧
// - vehicle_drivers に紐づきがあれば、その車両のみ
// - 紐づきがなければ、全車両を返す（暫定運用）
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

  // ベースクエリ（全車両）
  let query = supabase
    .from("vehicles")
    .select(
      "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage",
    )
    .order("manufacturer")
    .order("brand");

  // 紐付けがある場合のみ in で絞り込む
  if (ids.length > 0) {
    query = query.in("id", ids);
  }

  const { data: vehicles, error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ vehicles: vehicles ?? [], driverId: user.driverId, vehicleIds: ids });
}
