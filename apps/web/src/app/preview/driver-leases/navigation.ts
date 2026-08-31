import type { DayFilter } from "./dayFilter";

export type PreviewPage = "shifts" | "drivers";
export type LoanSeed = { date: string; vehicleId?: string; borrowerId?: string };
export type PreviewTarget = { page: PreviewPage; driverId?: string; date?: string; loanId?: string; repairSave?: boolean };
export const PAGE_NAMES: Record<PreviewPage, string> = { shifts: "シフト", drivers: "ドライバー一覧" };

export type ShiftView = {
  labelIds: string[]; mode: string; query: string; grouped: boolean;
  yearMonth: { year: number; month: number }; half: string; axis: string; day: number;
  showShift: boolean; showVehicle: boolean; showMeetingTime: boolean;
  dayFilter: DayFilter;
  // 未操作なら車両表示に合わせる。手動指定後はその選択を優先する。
  showDriverDetails: boolean | null;
};
export const initialShiftView = (): ShiftView => ({ labelIds: [], mode: "all", query: "", grouped: true, yearMonth: { year: 2026, month: 9 }, half: "first", axis: "driver", showShift: true, showVehicle: true, showMeetingTime: false, day: 0, dayFilter: "working", showDriverDetails: null });
export const driverDetailsVisible = (view: ShiftView): boolean => view.showDriverDetails ?? view.showVehicle;
export function viewAtDate(view: ShiftView, date: string): ShiftView {
  const [year, month, day] = date.split("-").map(Number);
  return { ...view, yearMonth: { year, month }, half: day < 16 ? "first" : "second", day: day < 16 ? day - 1 : day - 16 };
}

export function dateForView(view: ShiftView): string {
  const { year, month } = view.yearMonth;
  const start = view.half === "first" ? 1 : 16;
  const last = view.half === "first" ? 15 : new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(last, start + view.day)).padStart(2, "0")}`;
}
export function moveViewByDay(view: ShiftView, direction: number): ShiftView {
  const date = new Date(dateForView(view) + "T12:00:00");
  date.setDate(date.getDate() + direction);
  return viewAtDate(view, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
}
