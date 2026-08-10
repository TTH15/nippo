import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 駐車区画（migration 126）。拠点の中の1台分の区画。
// 「出発地（稼働開始を押す場所）」の正体であり、車両の向き合わせと
// ドライバーの「今日の車どこ？」に使う。
//
// 向き（bearing）は**サーバーで矩形から算出**する。人にもクライアントにも角度を持たせない。
// ============================================================

type Ring = [number, number][];

/** 2点間の方位（度・北=0）。 */
function bearingOf(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(lat);
  const dy = b[1] - a[1];
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** 矩形の「長辺」から車体の軸を決める。区画に沿っていれば前後は問わない。 */
function bearingFromRect(ring: Ring): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const dx = (b[0] - a[0]) * Math.cos(lat);
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      best = bearingOf(a, b);
    }
  }
  return best;
}

function centerOf(ring: Ring): { lat: number; lng: number } {
  const pts = ring.slice(0, -1); // 閉じた環の重複点を除く
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { lat, lng };
}

function readRing(geometry: unknown): Ring | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g || g.type !== "Polygon" || !Array.isArray(g.coordinates)) return null;
  const ring = g.coordinates[0] as Ring | undefined;
  if (!Array.isArray(ring) || ring.length < 4) return null;
  if (!ring.every((p) => Array.isArray(p) && p.length >= 2 && p.every((n) => Number.isFinite(n)))) return null;
  return ring;
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const { data, error } = await supabase
    .from("parking_slots")
    .select("id, place_id, label, geometry, bearing, lat, lng, vehicle_id")
    .eq("org_id", orgId)
    .order("label");

  if (error) {
    // migration 126 未適用でも地図を落とさない
    console.error("[parking-slots] list error", error);
    return NextResponse.json({ slots: [], available: false });
  }
  return NextResponse.json({ slots: data ?? [], available: true });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => null);
  const placeId = typeof body?.placeId === "string" ? body.placeId : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const ring = readRing(body?.geometry);
  const vehicleId = typeof body?.vehicleId === "string" && body.vehicleId ? body.vehicleId : null;

  if (!placeId || !label || label.length > 20) {
    return NextResponse.json({ error: "拠点と区画名（20文字以内）を指定してください" }, { status: 400 });
  }
  if (!ring) {
    return NextResponse.json({ error: "区画の形が正しくありません" }, { status: 400 });
  }

  // 他社の拠点にぶら下げられないようテナントを確認する
  const { data: place } = await supabase
    .from("map_places")
    .select("id")
    .eq("id", placeId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!place) return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });

  const center = centerOf(ring);
  const { data, error } = await supabase
    .from("parking_slots")
    .insert({
      org_id: orgId,
      place_id: placeId,
      label,
      geometry: body.geometry,
      bearing: bearingFromRect(ring),
      lat: center.lat,
      lng: center.lng,
      vehicle_id: vehicleId,
    })
    .select("id, place_id, label, geometry, bearing, lat, lng, vehicle_id")
    .single();

  if (error) {
    console.error("[parking-slots] insert error", error);
    if (error.code === "23505") {
      return NextResponse.json({ error: "その車両は既に別の区画に割り当てられています" }, { status: 400 });
    }
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ slot: data });
}
