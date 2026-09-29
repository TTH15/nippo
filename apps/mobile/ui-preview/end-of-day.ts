// 終了後の表示状態。日報と駐車は別管理し、位置未取得で完了を妨げない。
export type EndOfDay = { workDate: string; finishedOn: string; report: "pending" | "submitted" };
export function finishWork(workDate: string, finishedOn: string): EndOfDay {
  return { workDate, finishedOn, report: "pending" };
}
export function submitDayReport(day: EndOfDay | null, workDate: string): EndOfDay | null {
  return day?.workDate === workDate ? { ...day, report: "submitted" } : day;
}
export function nextPreviewShiftDate(date: string): string {
  // 架空シフト。同じ入力をホームとシフトfixtureで使う。
  return new Date(Date.parse(`${date}T00:00:00Z`) + 2 * 86400_000).toISOString().slice(0, 10);
}
export function displayShiftDate(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" }).format(new Date(`${date}T00:00:00+09:00`)).replace("(", "（").replace(")", "）");
}

export type ParkingState = "pending" | "located" | "unlocated" | null;
export function closeoutProgress(day: EndOfDay, parking: ParkingState) {
  const reportDone = day.report === "submitted";
  // 位置だけ未確定でも写真の受付が済めばドライバーの提出は完了。
  const parkingDone = parking === "located" || parking === "unlocated";
  return { reportDone, parkingDone, complete: reportDone && parkingDone, remaining: Number(!reportDone) + Number(!parkingDone) };
}
