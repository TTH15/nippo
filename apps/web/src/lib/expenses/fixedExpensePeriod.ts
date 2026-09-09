// ============================================================
// 固定控除の期間まわり（純粋ロジック）。
//
// 固定控除は「ずっと引く」しか作れず、リース契約へ切り替えたあとも古い
// 「リース代」が引かれ続けて二重になっていた（2026-09-09 実データで発生・
// 月額リースの5名で 199,000円/月）。終わりの月を決められるようにするための道具。
// ============================================================

/** 画面で扱う月の形 */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * "YYYY-MM" → その月の末日 "YYYY-MM-DD"。
 * 固定控除の `valid_to` は日付なので、月の指定を末日に直して保存する。
 * うるう年・30日の月をここで吸収する（手で 31 を付けると2月がずれる）。
 */
export function endOfMonthDate(month: string): string | null {
  if (!MONTH_RE.test(month)) return null;
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** 保存済みの `valid_to`（日付）を画面の月へ戻す */
export function monthOf(date: string | null | undefined): string {
  const value = String(date ?? "");
  return MONTH_RE.test(value.slice(0, 7)) ? value.slice(0, 7) : "";
}

/**
 * リース契約と二重に引いてしまう名前か。
 * 名前は自由入力なので完全には判定できないが、「リース」を含む固定控除は
 * リース契約と重なりやすいので、その場で気づけるようにする。
 */
export const looksLikeLease = (name: string): boolean => /リース/.test(name ?? "");
