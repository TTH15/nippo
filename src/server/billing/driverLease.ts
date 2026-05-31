import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// ドライバーのリース控除（専用概念 driver_leases）を集計する共有ロジック。
//   MONTHLY: 毎月一定額をフラット控除（稼働日数に依らない）
//   DAILY:   日額 × 稼働日数 を控除（日当＝日次報酬に反映）
// リースは course_unit_rates / course_fixed_rates（コース単価＝gross）とは別レイヤー。
// computeDriverAutoPayout は gross のまま保ち、各 consumer がリースを控除する。
// ※ 車両 vehicles.lease_cost（会社の回収）とは無関係。
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
  if (amount <= 0) return null;
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

/** 日割り表示用の日額。DAILY なら日額、MONTHLY/null は 0（日次には反映しない） */
export function leaseDailyRate(lease: DriverLease): number {
  return lease?.mode === "DAILY" ? lease.amount : 0;
}

/** 期間のリース控除合計。MONTHLY=月額(有効なら) / DAILY=日額×稼働日数 */
export function leaseDeductionForRange(lease: DriverLease, workedDays: number): number {
  if (!lease) return 0;
  if (lease.mode === "MONTHLY") return lease.amount;
  return lease.amount * Math.max(0, workedDays);
}
