import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// GET: 車両1台の詳細（整備情報＋最後の位置の記録）。
//
// ナンバープレートの長押しで出すシートが使う（2026-09-08 ユーザー依頼）。
// 地図の /api/admin/map/vehicles は会社の全車を組み立てるため重い。1台だけなら
// 素直に最新1行を引けばよいので、そちらとは別口にする。
// 返す形と意味（source / sessionStatus / driverName / placeName）は地図と同じに揃え、
// 表示は共通の VehicleDetailCard が受け持つ。
// ============================================================

const VEHICLE_COLS =
  "id, number_prefix, number_class, number_hiragana, number_numeric, plate_color, manufacturer, brand, current_mileage, last_oil_change_mileage, oil_change_interval, is_ev, next_shaken_date, is_unavailable, unavailable_reason";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id } = await ctx.params;

  // 他社の車両 ID を渡されても中身を返さない（404 にして存在も伏せる）
  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select(VEHICLE_COLS)
    .eq("id", id)
    .eq("owner_org_id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[vehicles/detail] vehicle error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!vehicle) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 最後の記録。座標なしの駐車申告（「別の場所」）が最新なら、地図と同じく
  // 以前の点を現在地として出さず、名前と日時だけ返す。
  const { data: positions } = await supabase
    .from("vehicle_positions")
    .select("at, lat, lng, source, recorded_by, note, kind, place_name")
    .eq("org_id", orgId)
    .eq("vehicle_id", id)
    .order("at", { ascending: false })
    .limit(5);

  const latest = (positions ?? [])[0] as
    | {
        at: string;
        lat: number | null;
        lng: number | null;
        source: string;
        recorded_by: string | null;
        note: string | null;
        kind?: string | null;
        place_name?: string | null;
      }
    | undefined;

  const { data: session } = await supabase
    .from("vehicle_sessions")
    .select("status, recorded_by, started_at, ended_at")
    .eq("vehicle_id", id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const driverIds = [latest?.recorded_by, session?.recorded_by].filter((v): v is string => !!v);
  const { data: drivers } = driverIds.length
    ? await supabase.from("drivers").select("id, name, display_name").in("id", [...new Set(driverIds)])
    : { data: [] as { id: string; name: string | null; display_name: string | null }[] };
  const nameById = new Map((drivers ?? []).map((d) => [d.id, d.display_name || d.name || ""]));

  const open = session?.status === "open";
  const hasCoords = latest && latest.lat != null && latest.lng != null;

  return NextResponse.json({
    vehicle: {
      ...vehicle,
      position: latest
        ? {
            at: latest.at,
            lat: hasCoords ? latest.lat : null,
            lng: hasCoords ? latest.lng : null,
            source: latest.source,
            kind: latest.source === "punch" ? "checkin" : latest.source,
            placedBy: latest.recorded_by ? (nameById.get(latest.recorded_by) ?? "") : "",
            note: latest.note ?? null,
            placeName: latest.kind === "parked" ? (latest.place_name ?? null) : null,
            sessionStatus: open ? "open" : "closed",
            driverName: session?.recorded_by ? (nameById.get(session.recorded_by) ?? "") : "",
          }
        : null,
    },
  });
}
