import { supabase } from "@/server/db/client";

// ============================================================
// 打刻の位置を vehicle_positions へ追記する（source='punch'）。
// 位置の正本は vehicle_positions（migration 122・docs/design/map-board.md）。
// vehicle_sessions にも従来どおり start/end の座標は残す（既存の集計・帳票が参照しているため）が、
// 地図が読むのはこちらの時系列。**位置が無い（GPS拒否）打刻では行を作らない**。
// ============================================================

export async function recordPunchPosition(params: {
  orgId: string;
  vehicleId: string;
  at: string;
  lat: unknown;
  lng: unknown;
  recordedBy: string | null;
}): Promise<void> {
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

  const { error } = await supabase.from("vehicle_positions").insert({
    org_id: params.orgId,
    vehicle_id: params.vehicleId,
    at: params.at,
    lat,
    lng,
    source: "punch",
    recorded_by: params.recordedBy,
  });
  // 位置の記録に失敗しても打刻自体は成立させる（現場を止めない）
  if (error) console.error("[positions] punch insert error", error);
}
