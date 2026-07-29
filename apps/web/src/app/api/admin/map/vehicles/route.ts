import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 地図（ベータ）用の車両一覧。各車両の最終確認位置を添える。
// 位置の正本は vehicle_sessions の打刻GPS: open（稼働中）は出勤地点、closed は退勤地点
// （無ければ出勤地点）。GPS が拒否/取得不可のセッションはスキップし、遡って最新の
// 座標付きセッションを使う。位置が一度も無い車両は position: null で返す。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data: vehicles, error: vehErr } = await supabase
    .from("vehicles")
    .select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand")
    .eq("owner_org_id", orgId)
    .eq("is_disposed", false);

  if (vehErr) {
    console.error("[map/vehicles] vehicles error", vehErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 直近のセッションから車両ごとの最新座標を拾う（座標なしは飛ばして遡る）。
  const { data: sessions, error: sesErr } = await supabase
    .from("vehicle_sessions")
    .select(
      "vehicle_id, status, started_at, ended_at, start_lat, start_lng, end_lat, end_lng, recorded_by",
    )
    .eq("org_id", orgId)
    .order("started_at", { ascending: false })
    .limit(1000);

  if (sesErr) {
    console.error("[map/vehicles] sessions error", sesErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  type Position = {
    lat: number;
    lng: number;
    at: string | null;
    kind: "checkin" | "checkout";
    sessionStatus: "open" | "closed";
    driverId: string | null;
  };
  const positionByVehicle = new Map<string, Position>();
  for (const s of sessions ?? []) {
    if (positionByVehicle.has(s.vehicle_id)) continue;
    // closed は退勤地点を優先（現在地に最も近い）。open や退勤GPSなしは出勤地点。
    const useEnd = s.status === "closed" && s.end_lat != null && s.end_lng != null;
    const lat = useEnd ? s.end_lat : s.start_lat;
    const lng = useEnd ? s.end_lng : s.start_lng;
    if (lat == null || lng == null) continue;
    positionByVehicle.set(s.vehicle_id, {
      lat,
      lng,
      at: useEnd ? s.ended_at : s.started_at,
      kind: useEnd ? "checkout" : "checkin",
      sessionStatus: s.status,
      driverId: s.recorded_by,
    });
  }

  const driverIds = [
    ...new Set([...positionByVehicle.values()].map((p) => p.driverId).filter(Boolean)),
  ] as string[];
  const { data: drivers } = driverIds.length
    ? await supabase.from("drivers").select("id, name, display_name").in("id", driverIds)
    : { data: [] as { id: string; name: string | null; display_name: string | null }[] };
  const driverNameById = new Map(
    (drivers ?? []).map((d) => [d.id, d.display_name || d.name || ""]),
  );

  const items = (vehicles ?? []).map((v) => {
    const p = positionByVehicle.get(v.id);
    return {
      ...v,
      position: p
        ? {
            lat: p.lat,
            lng: p.lng,
            at: p.at,
            kind: p.kind,
            sessionStatus: p.sessionStatus,
            driverName: p.driverId ? (driverNameById.get(p.driverId) ?? "") : "",
          }
        : null,
    };
  });

  return NextResponse.json({ vehicles: items });
}
