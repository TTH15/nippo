import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// ドライバーのリース控除（専用概念 driver_leases）。
//   MONTHLY: 毎月一定額をフラット控除（driver_leases.amount・稼働日数に依らない）
//   DAILY:   その日に走ったコースの日額リース代(courses.daily_lease)を稼働日ごとに控除
//            ＝金額はドライバーでなく「コース」が正。複数コース日は最大日額を1回。
// リースは course_unit_rates / course_fixed_rates（コース単価＝gross）とは別レイヤー。
// computeDriverAutoPayout は gross のまま保ち、各 consumer がリースを控除する。
// 同額は使用車両(daily_reports_v2.vehicle_id)の初期費用回収へ自動計上（vehicle recovery v2）。
// ※ 車両 vehicles.lease_cost（会社の回収レート）とは無関係。
// ============================================================

export type DriverLease = { mode: "MONTHLY" | "DAILY"; amount: number } | null;

type LeaseRow = {
  driver_id: string;
  mode: string | null;
  amount: number | null;
  valid_from: string | null;
};

function normalize(row: LeaseRow): DriverLease {
  const mode = row.mode === "DAILY" ? "DAILY" : row.mode === "MONTHLY" ? "MONTHLY" : null;
  if (!mode) return null;
  const amount = Number(row.amount) || 0;
  // MONTHLY は金額必須。DAILY は金額をコース側に持つため amount 不問。
  if (mode === "MONTHLY" && amount <= 0) return null;
  return { mode, amount };
}

/**
 * driver_ids × [startDate, endDate] に重なる有効リースを 1 ドライバー 1 件で返す。
 * 同時に複数期間が重なる場合は valid_from が最も新しい行を採用（運用上は同時1件）。
 */
export async function loadDriverLeases(
  supabase: SupabaseClient,
  driverIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, DriverLease>> {
  const result = new Map<string, DriverLease>();
  if (driverIds.length === 0) return result;

  const { data, error } = await supabase
    .from("driver_leases")
    .select("driver_id, mode, amount, valid_from")
    .in("driver_id", driverIds)
    .lte("valid_from", endDate)
    .or(`valid_to.is.null,valid_to.gte.${startDate}`)
    .order("valid_from", { ascending: true });

  if (error) {
    console.error("[driverLease] loadDriverLeases error", error);
    return result;
  }

  // valid_from 昇順なので、後勝ちで最新の有効期間を採用
  (data ?? []).forEach((row: LeaseRow) => {
    result.set(String(row.driver_id), normalize(row));
  });

  return result;
}

/** 単一ドライバーの現在有効なリース（無ければ null）。設定UIの読み込み用 */
export async function loadDriverLease(
  supabase: SupabaseClient,
  driverId: string,
  startDate: string,
  endDate: string,
): Promise<DriverLease> {
  const map = await loadDriverLeases(supabase, [driverId], startDate, endDate);
  return map.get(driverId) ?? null;
}

/**
 * コースID -> 日額リース代(円/稼働日)。
 * コースはテナント固有マスタなので、org を跨いだ日額が混ざらないよう orgId で絞る。
 */
export async function loadCourseDailyLease(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, number>> {
  const { data } = await supabase.from("courses").select("id, daily_lease").eq("org_id", orgId);
  const m = new Map<string, number>();
  (data ?? []).forEach((c: { id: string; daily_lease: number | null }) => {
    m.set(String(c.id), Math.max(0, Number(c.daily_lease) || 0));
  });
  return m;
}

/**
 * 期間のリース控除合計。
 *   MONTHLY: amount（有効なら定額）
 *   DAILY:   ユニーク稼働日ごとに「その日のコース日額（複数コース日は最大）」を合算
 */
export function computeLeaseDeduction(
  lease: DriverLease,
  perDay: { date: string; courseId: string | null }[],
  courseDailyLease: Map<string, number>,
): number {
  if (!lease) return 0;
  if (lease.mode === "MONTHLY") return lease.amount;
  const byDate = new Map<string, number>();
  for (const d of perDay) {
    const rate = d.courseId ? courseDailyLease.get(d.courseId) ?? 0 : 0;
    byDate.set(d.date, Math.max(byDate.get(d.date) ?? 0, rate));
  }
  let sum = 0;
  for (const v of byDate.values()) sum += v;
  return sum;
}

/** 日次表示用: DAILY ならそのコースの日額、それ以外は 0 */
export function leaseDailyRateForCourse(
  lease: DriverLease,
  courseId: string | null,
  courseDailyLease: Map<string, number>,
): number {
  if (lease?.mode !== "DAILY" || !courseId) return 0;
  return courseDailyLease.get(courseId) ?? 0;
}
