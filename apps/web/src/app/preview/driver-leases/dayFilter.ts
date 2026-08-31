import { courseIdsFor, shiftFor, type Demo, type Driver } from "./model";

export const DAY_FILTER_LABELS = { all: "全員", working: "稼働", unassigned: "未割当" } as const;
export type DayFilter = keyof typeof DAY_FILTER_LABELS;
export type DayCounts = Record<DayFilter, number>;

// 実シフト画面と同じく、未割当には希望休も含む。車両の有無では判定しない。
export function hasDayAssignment(demo: Demo, driver: Driver, date: string): boolean {
  return courseIdsFor(shiftFor(demo, driver.id, date)).length > 0;
}
export function filterDayDrivers(demo: Demo, drivers: Driver[], date: string, filter: DayFilter): Driver[] {
  return drivers.filter(driver => filter === "all" || hasDayAssignment(demo, driver, date) === (filter === "working"));
}
export function countDayDrivers(demo: Demo, drivers: Driver[], date: string): DayCounts {
  const working = drivers.filter(driver => hasDayAssignment(demo, driver, date)).length;
  return { all: drivers.length, working, unassigned: drivers.length - working };
}
