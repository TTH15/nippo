import type { MeShift, MeShiftRest } from "@repo/core/types";
export const fullCourseName = (shift: MeShift) => shift.course_full_name?.trim() || shift.course_name?.trim() || "コース未設定";
export const shiftTime = (time?: string | null) => time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "未設定";
export const restLabel = (rest: MeShiftRest) => `${rest.kind === "requested" ? "希望休" : "指定休"}${rest.slot_label ? `（${rest.slot_label}）` : ""}`;
/** 指定休=希望休も割当もない日（ユーザー定義）。取得失敗時は推定しない。 */
export function resolveMonthRests(year: number, month: number, shifts: MeShift[], rests: MeShiftRest[], available: boolean): MeShiftRest[] {
  if (!available) return rests;
  const result = [...rests], occupied = new Set([...shifts.map(s => s.shift_date), ...rests.map(r => r.date)]);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
    const date = `${prefix}-${String(day).padStart(2, "0")}`;
    if (!occupied.has(date)) result.push({ date, kind: "designated" });
  }
  return result;
}
export function shiftDaySummary(shifts: MeShift[], rests: MeShiftRest[]) {
  return [...(shifts.length ? [`稼働${shifts.length}件`] : []), ...rests.map(restLabel)].join("・") || "割当なし";
}
export function shiftDateLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d, 12).getDay()]}）`;
}
