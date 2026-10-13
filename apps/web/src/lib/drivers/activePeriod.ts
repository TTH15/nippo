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

export type DriverMembershipPeriod = DriverActivePeriod & {
  status?: string | null;
  created_at?: string | null;
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

/**
 * 一覧表示用の所属期間判定。編集権限や支払額の計算には使わない。
 * 明示された開始・終了月は月全体を含む。開始月が未入力のときだけ登録日(JST)で
 * 新規登録者の開始前表示を防ぐ。日時も欠落した旧データは従来どおり保持する。
 * 自社の対象期間内の実績は呼出側で別途保持する（移行登録や再稼働の過去を消さない）。
 */
export function isMemberInPeriod(driver: DriverMembershipPeriod, start: string, end: string): boolean {
  if (driver.status !== "active" && driver.status !== "inactive") return false;
  const from = monthOrNull(driver.active_from_month);
  const until = monthOrNull(driver.active_until_month);
  if (from && end.slice(0, 7) < from) return false;
  if (until && start.slice(0, 7) > until) return false;
  // タイムゾーンのない壊れた値から日付を補完しない。
  if (!from && driver.created_at && /(Z|[+-]\d{2}:\d{2})$/.test(driver.created_at)) {
    const registeredAt = Date.parse(driver.created_at);
    if (Number.isFinite(registeredAt)) {
      const registeredDate = new Date(registeredAt + 9 * 3600_000).toISOString().slice(0, 10);
      if (end < registeredDate) return false;
    }
  }
  return true;
}
