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

  // migration 123（model_key / body_color）が未適用の環境でも動くよう、失敗したら旧 select で取り直す。
  const VEHICLE_COLS = "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand";
  let vehicles: Record<string, unknown>[] | null = null;
  {
    const withAppearance = await supabase
      .from("vehicles")
      .select(`${VEHICLE_COLS}, model_key, body_color`)
      .eq("owner_org_id", orgId)
      .eq("is_disposed", false);
    if (withAppearance.error) {
      const fallback = await supabase
        .from("vehicles")
        .select(VEHICLE_COLS)
        .eq("owner_org_id", orgId)
        .eq("is_disposed", false);
      if (fallback.error) {
        console.error("[map/vehicles] vehicles error", fallback.error);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      vehicles = fallback.data as Record<string, unknown>[];
    } else {
      vehicles = withAppearance.data as Record<string, unknown>[];
    }
  }

  // 車両ごとの最新1行は RPC（migration 134・DISTINCT ON）で DB 側に絞らせる。
  // 未適用環境では従来の固定 limit スキャンへフォールバック（行数が増えると
  // limit の外に落ちた古い車両が黙って消える問題があるため、RPC 適用が本命）。
  type PositionRow = {
    vehicle_id: string;
    at: string;
    lat: number;
    lng: number;
    source: string;
    recorded_by: string | null;
    note: string | null;
  };
  type SessionRow = {
    vehicle_id: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    recorded_by: string | null;
    start_lat: number | null;
    start_lng: number | null;
    end_lat: number | null;
    end_lng: number | null;
  };
  type HistoryNeighbors = { previousAt: string | null; nextAt: string | null };

  const loadPositions = async (): Promise<{ rows: PositionRow[]; unavailable: boolean }> => {
    try {
      const { data, error } = await supabase.rpc("map_latest_positions", {
        p_org: orgId,
        p_at: asOf,
      });
      if (!error && Array.isArray(data)) return { rows: data as PositionRow[], unavailable: false };
    } catch {
      // RPC 未適用など。従来スキャンへ
    }
    let q = supabase
      .from("vehicle_positions")
      .select("vehicle_id, at, lat, lng, source, recorded_by, note")
      .eq("org_id", orgId)
      .order("at", { ascending: false })
      .limit(POSITION_SCAN_LIMIT);
    if (asOf) q = q.lte("at", asOf);
    const { data, error } = await q;
    // migration 122 が未適用の環境（＝テーブルが無い）では地図を落とさず、
    // 従来どおり打刻GPSから位置を導出するモードで動かす。業務画面を止めないことを優先する。
    if (error) {
      console.error("[map/vehicles] positions unavailable, falling back to punch GPS", error);
      return { rows: [], unavailable: true };
    }
    return { rows: (data ?? []) as PositionRow[], unavailable: false };
  };

  const loadSessions = async (): Promise<SessionRow[]> => {
    try {
      const { data, error } = await supabase.rpc("map_latest_sessions", {
        p_org: orgId,
        p_at: asOf,
      });
      if (!error && Array.isArray(data)) return data as SessionRow[];
    } catch {
      // RPC 未適用など。従来スキャンへ
    }
    let q = supabase
      .from("vehicle_sessions")
      .select("vehicle_id, status, started_at, ended_at, recorded_by, start_lat, start_lng, end_lat, end_lng")
      .eq("org_id", orgId)
      .order("started_at", { ascending: false })
      .limit(1000);
    if (asOf) q = q.lte("started_at", asOf);
    const { data } = await q;
    return (data ?? []) as SessionRow[];
  };

  const loadHistoryNeighbors = async (): Promise<HistoryNeighbors | null> => {
    if (!asOf) return null;
    const now = new Date().toISOString();
    const [previous, next] = await Promise.all([
      supabase
        .from("vehicle_positions")
        .select("at")
        .eq("org_id", orgId)
        .lt("at", asOf)
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("vehicle_positions")
        .select("at")
        .eq("org_id", orgId)
        .gt("at", asOf)
        .lte("at", now)
        .order("at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    if (previous.error || next.error) return null;
    return {
      previousAt: previous.data?.at ?? null,
      nextAt: next.data?.at ?? null,
    };
  };

  // 位置とセッションは独立に取れるため並列で
  const [{ rows: positions, unavailable: positionsUnavailable }, sessions, historyNeighbors] = await Promise.all([
    loadPositions(),
    loadSessions(),
    loadHistoryNeighbors(),
  ]);

  // 新しい順に並んでいるので、車両ごとに最初に出てきた行が as-of の位置になる
  // （RPC の場合は既に1台1行）。
  type Position = {
    lat: number;
    lng: number;
    at: string;
    source: "punch" | "manual" | "gps";
    recordedBy: string | null;
    note: string | null;
  };
  const positionByVehicle = new Map<string, Position>();
  for (const p of positionsUnavailable ? [] : positions) {
    if (positionByVehicle.has(p.vehicle_id)) continue;
    positionByVehicle.set(p.vehicle_id, {
      lat: p.lat,
      lng: p.lng,
      at: p.at,
      source: p.source as Position["source"],
      recordedBy: p.recorded_by ?? null,
      note: p.note ?? null,
    });
  }

  type SessionInfo = { open: boolean; driverId: string | null };
  const sessionByVehicle = new Map<string, SessionInfo>();
  for (const s of sessions ?? []) {
    if (sessionByVehicle.has(s.vehicle_id)) continue;
    // as-of 時点で「開始済み かつ 未終了（またはその時刻より後に終了）」なら稼働中
    const endedAt = s.ended_at as string | null;
    const open = asOf ? !endedAt || endedAt > asOf : s.status === "open";
    sessionByVehicle.set(s.vehicle_id, { open, driverId: (s.recorded_by as string | null) ?? null });
  }

  if (positionsUnavailable) {
    for (const s of sessions ?? []) {
      if (positionByVehicle.has(s.vehicle_id)) continue;
      const useEnd = s.status === "closed" && s.end_lat != null && s.end_lng != null;
      const lat = (useEnd ? s.end_lat : s.start_lat) as number | null;
      const lng = (useEnd ? s.end_lng : s.start_lng) as number | null;
      if (lat == null || lng == null) continue;
      positionByVehicle.set(s.vehicle_id, {
        lat,
        lng,
        at: (useEnd ? s.ended_at : s.started_at) as string,
        source: "punch",
        recordedBy: (s.recorded_by as string | null) ?? null,
        note: null,
      });
    }
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
    const p = positionByVehicle.get(v.id as string);
    const s = sessionByVehicle.get(v.id as string);
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

  return NextResponse.json({ vehicles: items, asOf, historyNeighbors });
}
