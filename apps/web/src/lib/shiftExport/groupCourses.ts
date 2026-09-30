import { shouldShowCycleBadgesForSelection } from "@repo/core/logic/courseCycle";
import type { ShiftExportCourse } from "./data";

type CourseEntry = ShiftExportCourse & {
  courseId: string;
  cycleNo: number;
  activeCycleNos: number[];
  cycleBadge: string;
};

/** 同じ日の同じコースを1枚にまとめる。片便だけの日は便名を残す。 */
export function groupShiftExportCourses(entries: CourseEntry[]): ShiftExportCourse[] {
  const groups = new Map<string, { entry: CourseEntry; cycles: Map<number, string> }>();
  for (const entry of entries) {
    const group = groups.get(entry.courseId);
    if (group) group.cycles.set(entry.cycleNo, entry.cycleBadge);
    else groups.set(entry.courseId, { entry, cycles: new Map([[entry.cycleNo, entry.cycleBadge]]) });
  }
  return [...groups.values()].map(({ entry, cycles }) => {
    const selected = [...cycles.keys()].sort((a, b) => a - b);
    const label = shouldShowCycleBadgesForSelection(selected, entry.activeCycleNos)
      ? `${entry.label} ${selected.map((no) => cycles.get(no)).join("・")}`
      : entry.label;
    return { label, color: entry.color, slotLabel: entry.slotLabel };
  });
}
