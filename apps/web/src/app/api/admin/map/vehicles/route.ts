import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// GET: 地図用の車両一覧。各車両の位置を添える。
//
// 位置の正本は **vehicle_positions（出どころ付きの時系列・migration 122）**。
//   source: punch=打刻GPS / manual=運営が地図上で配置 / gps=バックグラウンド位置
// 現在地 = 最新行、「◯月◯日◯時の位置」= at <= T の最新行（as-of）。
// クエリ `?at=<ISO8601>` を付けるとその時刻時点の位置を返す（履歴スクラブ・Stage 0.6）。
//
// 稼働中かどうか（sessionStatus）は位置とは別の事実なので vehicle_sessions から取る。
// 設計: docs/design/map-board.md
// ============================================================

/** 一度に読む位置の行数。1日1台あたり数行〜数十行なので直近ぶんはこれで足りる。 */
const POSITION_SCAN_LIMIT = 2000;

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  // as-of 指定（履歴表示）。不正な値は無視して現在扱いにする。
  const atParam = req.nextUrl.searchParams.get("at");
  const asOf = atParam && !Number.isNaN(Date.parse(atParam)) ? new Date(atParam).toISOString() : null;

  const { data: vehicles, error: vehErr } = await supabase
    .from("vehicles")
    .select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand")
    .eq("owner_org_id", orgId)
    .eq("is_disposed", false);

  if (vehErr) {
    console.error("[map/vehicles] vehicles error", vehErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let positionQuery = supabase
    .from("vehicle_positions")
    .select("vehicle_id, at, lat, lng, source, recorded_by, note")
    .eq("org_id", orgId)
    .order("at", { ascending: false })
    .limit(POSITION_SCAN_LIMIT);
  if (asOf) positionQuery = positionQuery.lte("at", asOf);

  const { data: positions, error: posErr } = await positionQuery;
  if (posErr) {
    console.error("[map/vehicles] positions error", posErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 新しい順に並んでいるので、車両ごとに最初に出てきた行が as-of の位置になる。
  type Position = {
    lat: number;
    lng: number;
    at: string;
    source: "punch" | "manual" | "gps";
    recordedBy: string | null;
    note: string | null;
  };
  const positionByVehicle = new Map<string, Position>();
  for (const p of positions ?? []) {
    if (positionByVehicle.has(p.vehicle_id)) continue;
    positionByVehicle.set(p.vehicle_id, {
      lat: p.lat as number,
      lng: p.lng as number,
      at: p.at as string,
      source: p.source as Position["source"],
      recordedBy: (p.recorded_by as string | null) ?? null,
      note: (p.note as string | null) ?? null,
    });
  }

  // 稼働中の判定と担当者。位置とは別の事実なのでセッションから取る。
  let sessionQuery = supabase
    .from("vehicle_sessions")
    .select("vehicle_id, status, started_at, ended_at, recorded_by")
    .eq("org_id", orgId)
    .order("started_at", { ascending: false })
    .limit(1000);
  if (asOf) sessionQuery = sessionQuery.lte("started_at", asOf);
  const { data: sessions } = await sessionQuery;

  type SessionInfo = { open: boolean; driverId: string | null };
  const sessionByVehicle = new Map<string, SessionInfo>();
  for (const s of sessions ?? []) {
    if (sessionByVehicle.has(s.vehicle_id)) continue;
    // as-of 時点で「開始済み かつ 未終了（またはその時刻より後に終了）」なら稼働中
    const endedAt = s.ended_at as string | null;
    const open = asOf ? !endedAt || endedAt > asOf : s.status === "open";
    sessionByVehicle.set(s.vehicle_id, { open, driverId: (s.recorded_by as string | null) ?? null });
  }

  const driverIds = [
    ...new Set(
      [
        ...[...sessionByVehicle.values()].map((s) => s.driverId),
        ...[...positionByVehicle.values()].map((p) => p.recordedBy),
      ].filter((id): id is string => !!id),
    ),
  ];
  const { data: drivers } = driverIds.length
    ? await supabase.from("drivers").select("id, name, display_name").in("id", driverIds)
    : { data: [] as { id: string; name: string | null; display_name: string | null }[] };
  const driverNameById = new Map((drivers ?? []).map((d) => [d.id, d.display_name || d.name || ""]));

  const items = (vehicles ?? []).map((v) => {
    const p = positionByVehicle.get(v.id);
    const s = sessionByVehicle.get(v.id);
    return {
      ...v,
      position: p
        ? {
            lat: p.lat,
            lng: p.lng,
            at: p.at,
            source: p.source,
            // 手動配置は「誰が置いたか」が本質（責任の所在）
            placedBy: p.recordedBy ? (driverNameById.get(p.recordedBy) ?? "") : "",
            note: p.note,
            // 互換のため従来キーも残す（FleetMapCard / FleetMapBoard が参照している）
            kind: p.source === "punch" ? "checkin" : p.source,
            sessionStatus: s?.open ? "open" : "closed",
            driverName: s?.driverId ? (driverNameById.get(s.driverId) ?? "") : "",
          }
        : null,
    };
  });

  return NextResponse.json({ vehicles: items, asOf });
}
