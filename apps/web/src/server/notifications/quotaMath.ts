// ============================================================
// 通数計算の純粋部分（DB に依存しない）。テスト対象。
// 集計本体は orgQuota.ts（supabase を使うため副作用あり）。
// ============================================================

/** 残数計算。上限なし（null）は残数の概念を持たない。 */
export function computeRemaining(limit: number | null, used: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - used);
}

/**
 * JST の当月初日を UTC ISO で返す。集計期間の下限に使う。
 * 実行環境のタイムゾーンに依存しないよう、JST の年月を Intl で取り出して
 * UTC で組み立てる（Date のローカル解釈を経由しない）。
 */
export function jstMonthStartIso(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value); // 1-12

  // 当月1日 00:00 JST は UTC で (year, month-1, 1, 00:00) の 9時間前
  const utcMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}
