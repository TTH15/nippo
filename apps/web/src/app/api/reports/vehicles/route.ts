import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, getCapabilities } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: ドライバーが選択可能な車両一覧
// 車両閲覧権限（can_view_vehicles）あり: 全車両（代理入力用）
// なし: 紐付けられた車両のみ
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  // 車両閲覧権限を持つメンバーは全車両（旧: ADMIN/ADMIN_VIEWER の role 文字列判定。
  // カスタムロールにも権限どおりに効かせるため capability 判定へ移行）
  const caps = await getCapabilities(user);
  if (caps.has("can_view_vehicles")) {
    // 単一テナント時代の名残で org フィルタが無かった箇所。当 org の車両に限定する。
    const orgId = await resolveOrgId(user.driverId);
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
      "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, last_oil_change_mileage, oil_change_interval, is_ev",
    )
    .in("id", vehicleIds)
    .eq("is_disposed", false)
    .order("manufacturer")
    .order("brand");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ vehicles: vehicles ?? [] });
}
