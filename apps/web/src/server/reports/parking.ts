// ============================================================
// 日報の「車の置き場所」（駐車申告）の検証と保存。
// 設計: docs/design/daily-report-parking-foundation.md（Phase 1: 保存基盤＋Web日報の入口）
// - 検証は純粋関数（parseParkingReport）にしてテストする
// - 保存は vehicle_positions へ kind='parked' / source='report' の1行。client_key で再送に耐える
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParkingDetectionSource, ParkingReport, ParkingReportStatus } from "@repo/core/types";
import type { SnapPlace } from "@/lib/map/dropSnap";
import { snapParkingCoords, type ParkingSnapResult } from "./parkingSnap";

const STATUSES: ParkingReportStatus[] = ["parked", "in_use", "handed_over", "later"];
const DETECTION_SOURCES: ParkingDetectionSource[] = ["session_end", "stop", "motion"];

export type ParsedParkingReport = {
  vehicleId: string;
  status: ParkingReportStatus;
  placeId: string | null;
  slotId: string | null;
  placeName: string | null;
  note: string | null;
  /** ISO。省略時は now */
  at: string;
  clientKey: string;
  /** 端末の測位。登録車庫を選ばない座標だけの申告でも parked を通す */
  coords: { lat: number; lng: number; accuracyM: number | null; fixAt: string | null } | null;
  detectedBy: ParkingDetectionSource | null;
};

export type ParkingParseResult = { ok: true; value: ParsedParkingReport } | { ok: false; error: string };

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * リクエストの parking を検証する。日報の items で使った車両と一致すること、
 * parked なら登録車庫・場所名・座標のいずれかがあること、日時が対象日の前日0時〜受信+5分に収まることを見る。
 */
export function parseParkingReport(
  raw: unknown,
  ctx: { reportDate: string; itemVehicleIds: (string | null | undefined)[]; now?: Date },
): ParkingParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "車の置き場所の内容を確認してください" };
  const body = raw as Partial<ParkingReport>;
  if (!isNonEmptyString(body.vehicleId)) return { ok: false, error: "車の置き場所には使用車両が必要です" };
  if (!ctx.itemVehicleIds.includes(body.vehicleId)) {
    return { ok: false, error: "車の置き場所の車両が日報の使用車両と一致しません" };
  }
  if (!STATUSES.includes(body.status as ParkingReportStatus)) return { ok: false, error: "車の置き場所の回答を選んでください" };
  if (!isNonEmptyString(body.clientKey) || body.clientKey.length > 64) return { ok: false, error: "送信の識別子が不正です" };

  const now = ctx.now ?? new Date();
  const placeId = isNonEmptyString(body.placeId) ? body.placeId : null;
  const slotId = isNonEmptyString(body.slotId) ? body.slotId : null;
  const placeName = isNonEmptyString(body.placeName) ? body.placeName.trim() : null;
  const note = isNonEmptyString(body.note) ? body.note.trim() : null;
  if (placeName && placeName.length > 80) return { ok: false, error: "場所名は80文字までです" };
  if (note && note.length > 200) return { ok: false, error: "メモは200文字までです" };
  if (slotId && !placeId) return { ok: false, error: "区画は登録車庫と一緒に選んでください" };

  // 対象日の前日0時（JST）より前、受信の5分後より未来は拒否する
  const earliest = new Date(`${ctx.reportDate}T00:00:00+09:00`).getTime() - 24 * 3600_000;
  const latest = now.getTime() + 5 * 60_000;
  if (Number.isNaN(earliest)) return { ok: false, error: "対象日が不正です" };
  const inWindow = (value: unknown): number | null => {
    const parsed = new Date(String(value));
    const time = parsed.getTime();
    if (Number.isNaN(time) || time < earliest || time > latest) return null;
    return time;
  };

  let coords: ParsedParkingReport["coords"] = null;
  if (body.coords != null) {
    const raw = body.coords;
    if (typeof raw !== "object") return { ok: false, error: "位置の内容を確認してください" };
    const { lat, lng } = raw;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90
      || typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, error: "位置が不正です" };
    }
    let accuracyM: number | null = null;
    if (raw.accuracyM != null) {
      if (typeof raw.accuracyM !== "number" || !Number.isFinite(raw.accuracyM) || raw.accuracyM < 0 || raw.accuracyM > 100_000) {
        return { ok: false, error: "位置の精度が不正です" };
      }
      accuracyM = raw.accuracyM;
    }
    let fixAt: string | null = null;
    if (raw.fixAt != null && raw.fixAt !== "") {
      const time = inWindow(raw.fixAt);
      if (time == null) return { ok: false, error: "測位時刻は対象日の前日から現在までにしてください" };
      fixAt = new Date(time).toISOString();
    }
    coords = { lat, lng, accuracyM, fixAt };
  }

  let detectedBy: ParkingDetectionSource | null = null;
  if (body.detectedBy != null) {
    if (!DETECTION_SOURCES.includes(body.detectedBy as ParkingDetectionSource)) {
      return { ok: false, error: "位置の取得方法が不正です" };
    }
    // 座標のない「自動で取れた」は根拠にならない
    if (!coords) return { ok: false, error: "位置の取得方法には座標が必要です" };
    detectedBy = body.detectedBy as ParkingDetectionSource;
  }

  if (body.status === "parked" && !placeId && !placeName && !coords) {
    return { ok: false, error: "停めた場所（登録車庫・場所名・位置）のどれかが必要です" };
  }

  let at = now.toISOString();
  if (body.at != null && body.at !== "") {
    const time = inWindow(body.at);
    if (time == null) return { ok: false, error: "駐車日時は対象日の前日から現在までにしてください" };
    at = new Date(time).toISOString();
  } else if (coords?.fixAt) {
    // 測位時刻が分かるなら、それを停めた時刻の既定にする（受信時刻で置き換えない）
    at = coords.fixAt;
  }

  return {
    ok: true,
    value: {
      vehicleId: body.vehicleId,
      status: body.status as ParkingReportStatus,
      placeId: body.status === "parked" ? placeId : null,
      slotId: body.status === "parked" ? slotId : null,
      placeName: body.status === "parked" ? placeName : null,
      note,
      at,
      clientKey: body.clientKey,
      coords: body.status === "parked" ? coords : null,
      detectedBy: body.status === "parked" ? detectedBy : null,
    },
  };
}

export type ParkingSaveResult = {
  saved: boolean;
  positionId: string | null;
  /** 座標だけの申告をどの車庫に当てたか。端末の終了サマリーに出す */
  snap: ParkingSnapResult | null;
  /** 位置は記録できなかったが、日報の完了は妨げない（migration 170 未適用など） */
  unavailable?: boolean;
};

/** 自社の駐車候補拠点。座標のない拠点は距離を測れないので外す */
async function loadParkingPlaces(db: SupabaseClient, orgId: string): Promise<SnapPlace[]> {
  const { data, error } = await db
    .from("map_places")
    .select("id, name, lat, lng, shape, radius_m")
    .eq("org_id", orgId)
    .eq("allow_parking", true)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error) throw new Error("車庫の確認に失敗しました");
  return (data ?? []) as SnapPlace[];
}

/**
 * 駐車申告を保存する。parked 以外は履歴に行を作らない（提出時の回答として扱う）。
 * 会社一致（車両・車庫・区画）はここで確認する。失敗は例外にして呼び出し側で扱う。
 */
export async function saveParkingReport(
  db: SupabaseClient,
  input: ParsedParkingReport,
  ctx: { orgId: string; driverId: string; reportDate: string },
): Promise<ParkingSaveResult> {
  if (input.status !== "parked") return { saved: false, positionId: null, snap: null };

  const { data: vehicle, error: vehicleError } = await db
    .from("vehicles")
    .select("id")
    .eq("id", input.vehicleId)
    .eq("owner_org_id", ctx.orgId)
    .maybeSingle();
  if (vehicleError) throw new Error("車両の確認に失敗しました");
  if (!vehicle) throw new Error("この車両には駐車場所を記録できません");

  let lat: number | null = null;
  let lng: number | null = null;
  let placeName = input.placeName;
  let placeId = input.placeId;
  let snap: ParkingSnapResult | null = null;
  // 端末の測位だけの申告は、座標をそのまま残したうえでサーバーが拠点を当てる。
  // 拠点の代表点で座標を置き換えない（測位した場所こそが「車のある場所」）。
  if (!placeId && input.coords) {
    lat = input.coords.lat;
    lng = input.coords.lng;
    snap = snapParkingCoords(input.coords, await loadParkingPlaces(db, ctx.orgId));
    if (snap.placeId) {
      placeId = snap.placeId;
      placeName = snap.placeName;
    }
  }
  if (input.placeId) {
    const { data: place, error: placeError } = await db
      .from("map_places")
      .select("id, name, lat, lng, allow_parking")
      .eq("id", input.placeId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (placeError) throw new Error("車庫の確認に失敗しました");
    if (!place || place.allow_parking === false) throw new Error("その車庫は選べません");
    lat = place.lat;
    lng = place.lng;
    placeName = place.name;
    if (input.slotId) {
      const { data: slot, error: slotError } = await db
        .from("parking_slots")
        .select("id, label, lat, lng")
        .eq("id", input.slotId)
        .eq("place_id", input.placeId)
        .eq("org_id", ctx.orgId)
        .maybeSingle();
      if (slotError) throw new Error("区画の確認に失敗しました");
      if (!slot) throw new Error("その区画は選べません");
      lat = slot.lat;
      lng = slot.lng;
      placeName = `${place.name} ${slot.label}`;
    }
  }

  // 端末の測位から来た申告かどうか。lat/lng がその測位そのものなら精度も意味を持つ
  const fromDevice = !input.placeId && input.coords != null;
  // migration 170 の列は、値があるときだけ送る。未適用の本番で従来の申告（Web・手動）が
  // 「存在しない列」で落ちないようにする（座標だけの申告は 170 の適用が前提）
  const deviceColumns: Record<string, unknown> = fromDevice
    ? { accuracy_m: input.coords?.accuracyM ?? null, detected_by: input.detectedBy }
    // 本人が車庫を選んだ場合、lat/lng は拠点の代表点になる。そこへ端末の精度を付けると
    // 「この座標が ±Nm」という別の意味になってしまうので精度は持たせず、
    // 「自動で気づいた申告だった」ことだけ detected_by に残す
    : input.coords != null && input.detectedBy != null && (lat != null && lng != null)
      ? { detected_by: input.detectedBy }
      : {};
  const row: Record<string, unknown> = {
    org_id: ctx.orgId,
    vehicle_id: input.vehicleId,
    at: input.at,
    lat,
    lng,
    source: "report",
    kind: "parked",
    recorded_by: ctx.driverId,
    driver_id: ctx.driverId,
    report_date: ctx.reportDate,
    place_id: placeId,
    slot_id: input.slotId,
    place_name: placeName,
    note: input.note,
    client_key: input.clientKey,
    ...deviceColumns,
  };
  // 同じ client_key の再送は上書き（二重登録しない）
  const { data, error } = await db
    // tenant-scope-ok: row.org_idはctx.orgId。保存前に駐車対象車両の利用権限を検証
    .from("vehicle_positions")
    .upsert(row, { onConflict: "org_id,vehicle_id,client_key" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[parking] upsert error", error);
    // 端末の測位だけの申告は migration 170 が要る。未適用の環境で日報の完了を止めず、
    // 「位置は記録できなかった」として返す（設計: 位置の失敗で日報を落とさない）
    if (fromDevice) return { saved: false, positionId: null, snap, unavailable: true };
    throw new Error("駐車場所の保存に失敗しました");
  }
  return { saved: true, positionId: data.id as string, snap };
}
