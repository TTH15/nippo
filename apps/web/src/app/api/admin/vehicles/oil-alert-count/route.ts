import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { countOilAlertVehicles, type OilVehicle } from "@repo/core/logic/oilChange";

export const dynamic = "force-dynamic";

// GET: オイル交換が迫っている（接近 or 要交換）車両の台数。
// メニューバッジ・ダッシュボードの警告に使用。しきい値は core/logic/oilChange に集約。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;

  try {
    const { data, error } = await supabase
      .from("vehicles")
      .select("current_mileage, last_oil_change_mileage, oil_change_interval, is_ev")
      .eq("is_disposed", false);

    if (error) {
      console.error("[admin/vehicles/oil-alert-count] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const count = countOilAlertVehicles((data ?? []) as OilVehicle[]);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[admin/vehicles/oil-alert-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
