import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// POST: 地図上で車両をドラッグして置いた位置を記録する（source='manual'）。
//
// GPS が入る前でも「いまどこにいるか」を運営が共有できるようにするための機能。
// **上書きではなく追記**する（設計: docs/design/map-board.md）。置き直した経緯が
// そのまま履歴になり、後から「何月何日◯時にどこにいたか」を辿れる。
//
// manual の位置は**集計（請求・稼働・走行距離）に使わない**。あくまで共有のための付箋。
// 誰が置いたかを recorded_by に必ず残す（責任の所在＝あとで揉めないため）。
// ============================================================

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_dispatch");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => null);
  const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;

  if (!vehicleId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "車両と座標を指定してください" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "座標が不正です" }, { status: 400 });
  }

  // 他社の車両を動かせないようにテナントを確認する（車両は org 分割の特例があるため明示的に見る）
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id")
    .eq("id", vehicleId)
    .eq("owner_org_id", orgId)
    .maybeSingle();
  if (!vehicle) {
    return NextResponse.json({ error: "車両が見つかりません" }, { status: 404 });
  }

  const at = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("vehicle_positions")
    .insert({
      org_id: orgId,
      vehicle_id: vehicleId,
      at,
      lat,
      lng,
      source: "manual",
      recorded_by: user.driverId,
      note,
    })
    .select("id, at")
    .single();

  if (error || !inserted) {
    console.error("[map/positions] insert error", error);
    return NextResponse.json({ error: "位置を保存できませんでした" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, position: { id: inserted.id, at: inserted.at, lat, lng } });
}
