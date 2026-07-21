import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 現在のドライバーに紐付けられていない車両一覧（他ドライバーに紐付いている可能性あり）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  // 単一テナント時代の名残で org フィルタが無く、他社の車両まで返していた（姉妹APIの
  // reports/vehicles には入っている）。テナント分離のため必須。
  const orgId = await resolveOrgId(user.driverId);

  try {
    // このドライバーに紐付く車両を除外する
    const { data: links, error: linksError } = await supabase
      .from("vehicle_drivers")
      .select("vehicle_id")
      .eq("driver_id", user.driverId);

    if (linksError) {
      console.error(linksError);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const linkedIds = new Set(
      (links ?? [])
        .map((l: { vehicle_id: string | null }) => l.vehicle_id)
        .filter((id): id is string => !!id),
    );

    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select(
        "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, last_oil_change_mileage, oil_change_interval, is_ev",
      )
      .eq("owner_org_id", orgId)
      .eq("is_disposed", false)
      .order("manufacturer")
      .order("brand");

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const others =
      vehicles?.filter((v: { id: string }) => !linkedIds.has(v.id)) ?? [];

    return NextResponse.json({ vehicles: others });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

