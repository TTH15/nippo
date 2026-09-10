// ============================================================
// 「その月に稼働していたか」の判定（純粋ロジック）。
//
// `drivers.status` は**いまの状態**しか表さないので、過去の月の判定には使えない
// （migration 100 の意図）。稼働開始月〜終了月（'YYYY-MM'・終了月 null = 継続中）で見る。
// 請求書一覧は既に同じ考え方で絞っている（`/api/admin/users?activeMonth=`）。
// ============================================================

export type DriverActivePeriod = {
  active_from_month?: string | null;
  active_until_month?: string | null;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthOrNull = (value: string | null | undefined): string | null =>
  value && MONTH_RE.test(value) ? value : null;

/**
 * その月に稼働していたか。
 * 開始月なし = 昔から在籍、終了月なし = いまも在籍として扱う
 * （どちらも未入力の人が実在するため、未入力を「稼働していない」と読まない）。
 */
export function isActiveInMonth(driver: DriverActivePeriod, month: string): boolean {
  if (!MONTH_RE.test(month)) return true;
  const from = monthOrNull(driver.active_from_month);
  const until = monthOrNull(driver.active_until_month);
  if (from && month < from) return false;
  if (until && month > until) return false;
  return true;
}
