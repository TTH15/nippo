// カレンダー描画・月送りのための純粋ヘルパー（プラットフォーム非依存）。
// 注: 端末ローカルタイムの Date を用いる（JST 固定ではない）。日報送信日の
// JST ロジックは reportDateDefaultJST（本ファイル）/ Web 側 @/lib/date を参照。
// それ以外は「画面に並べる暦」用。
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

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * "YYYY-MM-DD" → "M月D日(月)"。通知など「何曜日か」が判断に効く場面で使う。
 * 曜日は UTC で計算する（暦日そのものを見るのでタイムゾーンに依存させない）。
 */
export function formatMonthDayWeekdayJP(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAY_JP[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日(${weekday})`;
}

/**
 * 内部の日付文字列 "YYYY-MM-DD" を、年月日を省略しない画面表示へ変換する。
 * 利用者向けにISO形式をそのまま見せず、曜日も一目で確認できる形にする。
 */
export function formatDateSlashWeekdayJP(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAY_JP[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(y).padStart(4, "0")}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}（${weekday}）`;
}

/**
 * 日報用のデフォルト日付（日本時間 午前3:00 で日付が切り替わる）。
 * 3:00 より前は「前日」、3:00 以降は「当日」を返す。
 * Returns YYYY-MM-DD（JST）
 */
export function reportDateDefaultJST(): string {
  const now = new Date();
  // "ja-JP" + hour12:false の format() は "0時" のような非数値文字列を返すため、
  // Number(format()) は常に NaN になり cutoff が効かない。formatToParts() で
  // hour パートの値だけを取り出す。
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const dateStr = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  if (hour < 3) {
    const d = new Date(dateStr + "T12:00:00+09:00");
    d.setHours(d.getHours() - 24);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  }
  return dateStr;
}
