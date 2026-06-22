// カレンダー描画・月送りのための純粋ヘルパー（プラットフォーム非依存）。
// 注: 端末ローカルタイムの Date を用いる（JST 固定ではない）。日報送信日の
// JST ロジックは @/lib/date を参照。ここは「画面に並べる暦」用。
//
// month のインデックス規約はあえて2系統あり、呼び出し側の既存実装に合わせる:
//   - 0-indexed（0=1月）… getDaysInMonth / nowYearMonth0
//   - 1-indexed（1=1月）… monthDateRange / nowYearMonth1

/** 月の全日付を返す（month は 0-indexed）。 */
export function getDaysInMonth(year: number, month0: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month0, 1);
  while (date.getMonth() === month0) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

/** 月の日付範囲を YYYY-MM-DD で返す（month は 1-indexed）。 */
export function monthDateRange(
  year: number,
  month1: number,
): { start: string; end: string } {
  const mm = String(month1).padStart(2, "0");
  const lastDay = new Date(year, month1, 0).getDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Date をローカル基準の YYYY-MM-DD に変換する。 */
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Date をローカル基準の "HH:MM"（24時間）に変換する。 */
export function toLocalTimeStr(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/** 現在の年・月（month は 0-indexed）。 */
export function nowYearMonth0(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** 現在の年・月（month は 1-indexed）。 */
export function nowYearMonth1(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 年・月（month は 1-indexed）を "YYYY-MM" に整形する。 */
export function formatYearMonth(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → "M月D日"（ゼロ埋めを外す）。 */
export function formatMonthDayJP(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}
