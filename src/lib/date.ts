/**
 * Get today's date string in Asia/Tokyo timezone.
 * Returns YYYY-MM-DD
 */
export function todayJST(): string {
  return new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // sv-SE gives YYYY-MM-DD
}

/**
 * 日報用のデフォルト日付（日本時間 午前3:00 で日付が切り替わる）。
 * 3:00 より前は「前日」、3:00 以降は「当日」を返す。
 * Returns YYYY-MM-DD
 */
export function reportDateDefaultJST(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
  });
  const hour = Number(formatter.format(now));
  const dateStr = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  if (hour < 3) {
    const d = new Date(dateStr + "T12:00:00+09:00");
    d.setHours(d.getHours() - 24);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  }
  return dateStr;
}

/**
 * YYYY-MM-DD（JSTの日付）を DatePicker 用の Date に変換（JST の正午で解釈）
 */
export function reportDateStrToDate(s: string): Date {
  return new Date(s + "T12:00:00+09:00");
}

/**
 * Date を日報送信用の YYYY-MM-DD（JST）に変換
 */
export function dateToReportDateStr(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/**
 * Get current month string in Asia/Tokyo timezone.
 * Returns YYYY-MM
 */
export function currentMonthJST(): string {
  const d = new Date();
  const year = d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", year: "numeric" });
  const month = d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", month: "2-digit" });
  return `${year}-${month}`;
}
