import JapaneseHolidays from "japanese-holidays";

/** ローカル暦の YYYY-MM-DD が日本の祝日か（振替休日を含む） */
export function isJapanPublicHolidayYmd(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const local = new Date(y, mo, d, 12, 0, 0, 0);
  const name = JapaneseHolidays.isHoliday(local);
  return name != null && name !== "";
}
