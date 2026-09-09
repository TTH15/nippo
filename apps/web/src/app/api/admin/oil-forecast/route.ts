import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { fetchAllRows } from "@/server/aggregation/pagination";

export const dynamic = "force-dynamic";

// ============================================================
// GET: オイル交換の予測に使う「1日あたりの走行距離」の実績。
//
// シフト表で「この予定なら、この日に交換の距離に届く」を出すために使う。
// 残り距離は車両の登録値から画面側で出せるので、ここでは履歴だけを返す。
//
// 実績は日報のメーター差から取る。実データ（2026-05〜09）では
//   ・記録の 88% にメーター値が入っている
//   ・メーターが減った記録・極端な飛びは全体の 3% 未満
//   ・コース別で 52〜164 km/日 と3倍の開きがある
// ので、コース別の中央値を主に使い、実績が足りないコースは車ごとの中央値で補う。
// ============================================================

/** 何週間ぶんの実績から見るか。季節や担当替えの影響を拾いすぎない範囲 */
const WINDOW_DAYS = 56;
/** メーターの読み違い・入力ミスを外す（1日でこれ以上は走らない） */
const MAX_DAILY_KM = 600;
/** 中央値を信用する最小の件数。少ないと1回の外れ値で歪む */
const MIN_SAMPLES = 5;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  type Row = { vehicle_id: string | null; report_date: string; meter_value: number | null; course_id: string | null };
  let rows: Row[];
  try {
    // 順序を付けずに分割取得すると行が重複・欠落する（2026-08 の教訓）
    rows = await fetchAllRows<Row>((from: number, to: number) =>
      supabase
        .from("daily_reports_v2")
        .select("vehicle_id, report_date, meter_value, course_id")
        .eq("org_id", orgId)
        .gte("report_date", since)
        .order("vehicle_id", { ascending: true })
        .order("report_date", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error("[oil-forecast] reports error", e);
    // 予測が出せなくてもシフト表は動かす
    return NextResponse.json({ courseKmPerDay: {}, vehicleKmPerDay: {}, fleetKmPerDay: 0 });
  }

  // 車両ごとに日付順で並べ、連続する記録のメーター差を1日ぶんの走行距離とみなす
  const byVehicle = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.vehicle_id || typeof row.meter_value !== "number") continue;
    (byVehicle.get(row.vehicle_id) ?? byVehicle.set(row.vehicle_id, []).get(row.vehicle_id)!).push(row);
  }

  const courseSamples = new Map<string, number[]>();
  const vehicleSamples = new Map<string, number[]>();
  const all: number[] = [];

  for (const [vehicleId, list] of byVehicle) {
    list.sort((a, b) => a.report_date.localeCompare(b.report_date));
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1];
      const current = list[i];
      const km = (current.meter_value as number) - (previous.meter_value as number);
      // 減った記録（読み違い・別の車の入力）と極端な飛び（入力ミス）は捨てる
      if (km <= 0 || km > MAX_DAILY_KM) continue;
      const days =
        (Date.parse(`${current.report_date}T00:00:00Z`) - Date.parse(`${previous.report_date}T00:00:00Z`)) / 86400_000;
      // 1日ぶんとして数えられるのは、前の記録の翌日だけ（間が空くと何日ぶんか分からない）
      if (days !== 1) continue;
      all.push(km);
      (vehicleSamples.get(vehicleId) ?? vehicleSamples.set(vehicleId, []).get(vehicleId)!).push(km);
      if (current.course_id) {
        (courseSamples.get(current.course_id) ?? courseSamples.set(current.course_id, []).get(current.course_id)!).push(km);
      }
    }
  }

  const courseKmPerDay: Record<string, number> = {};
  for (const [courseId, samples] of courseSamples) {
    if (samples.length >= MIN_SAMPLES) courseKmPerDay[courseId] = Math.round(median(samples));
  }
  const vehicleKmPerDay: Record<string, number> = {};
  for (const [vehicleId, samples] of vehicleSamples) {
    if (samples.length >= MIN_SAMPLES) vehicleKmPerDay[vehicleId] = Math.round(median(samples));
  }

  return NextResponse.json({
    courseKmPerDay,
    vehicleKmPerDay,
    fleetKmPerDay: all.length ? Math.round(median(all)) : 0,
    windowDays: WINDOW_DAYS,
  });
}
