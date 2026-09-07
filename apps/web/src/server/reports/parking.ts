// ============================================================
// 日報の「車の置き場所」（駐車申告）の検証と保存。
// 設計: docs/design/daily-report-parking-foundation.md（Phase 1: 保存基盤＋Web日報の入口）
// - 検証は純粋関数（parseParkingReport）にしてテストする
// - 保存は vehicle_positions へ kind='parked' / source='report' の1行。client_key で再送に耐える
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParkingReport, ParkingReportStatus } from "@repo/core/types";

const STATUSES: ParkingReportStatus[] = ["parked", "in_use", "handed_over", "later"];

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
};

export type ParkingParseResult = { ok: true; value: ParsedParkingReport } | { ok: false; error: string };

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * リクエストの parking を検証する。日報の items で使った車両と一致すること、
 * parked なら登録車庫か場所名のどちらかがあること、日時が対象日の前日0時〜受信+5分に収まることを見る。
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

  if (body.status === "parked" && !placeId && !placeName) {
    return { ok: false, error: "停めた場所（登録車庫か場所名）を選んでください" };
  }

  let at = now.toISOString();
  if (body.at != null && body.at !== "") {
    const parsed = new Date(String(body.at));
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "駐車日時が不正です" };
    // 対象日の前日0時（JST）より前、受信の5分後より未来は拒否する
    const earliest = new Date(`${ctx.reportDate}T00:00:00+09:00`).getTime() - 24 * 3600_000;
    const latest = now.getTime() + 5 * 60_000;
    if (Number.isNaN(earliest)) return { ok: false, error: "対象日が不正です" };
    if (parsed.getTime() < earliest || parsed.getTime() > latest) {
      return { ok: false, error: "駐車日時は対象日の前日から現在までにしてください" };
    }
    at = parsed.toISOString();
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
    },
  };
}

/**
 * 駐車申告を保存する。parked 以外は履歴に行を作らない（提出時の回答として扱う）。
 * 会社一致（車両・車庫・区画）はここで確認する。失敗は例外にして呼び出し側で扱う。
 */
export async function saveParkingReport(
  db: SupabaseClient,
  input: ParsedParkingReport,
  ctx: { orgId: string; driverId: string; reportDate: string },
): Promise<{ saved: boolean; positionId: string | null }> {
  if (input.status !== "parked") return { saved: false, positionId: null };

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

  const row = {
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
    place_id: input.placeId,
    slot_id: input.slotId,
    place_name: placeName,
    note: input.note,
    client_key: input.clientKey,
  };
  // 同じ client_key の再送は上書き（二重登録しない）
  const { data, error } = await db
    .from("vehicle_positions")
    .upsert(row, { onConflict: "org_id,vehicle_id,client_key" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[parking] upsert error", error);
    throw new Error("駐車場所の保存に失敗しました");
  }
  return { saved: true, positionId: data.id as string };
}
