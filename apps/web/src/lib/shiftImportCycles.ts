export const SHIFT_IMPORT_IGNORE = "__ignore";

export type ShiftImportCourseChoice = { courseId: string; cycleNo: number };

export type ShiftImportCourseWithCycles = {
  id: string;
  uses_cycles?: boolean | null;
  course_cycles?: { cycle_no: number; active?: boolean | null }[] | null;
};

export function encodeShiftImportCourseChoice(courseId: string, cycleNo: number): string {
  return `${courseId}|${cycleNo}`;
}

export function parseShiftImportCourseChoice(
  value: string | undefined,
): ShiftImportCourseChoice | null {
  if (!value || value === SHIFT_IMPORT_IGNORE) return null;
  const separator = value.lastIndexOf("|");
  if (separator < 1) return { courseId: value, cycleNo: 0 };
  const cycleNo = Number(value.slice(separator + 1));
  return {
    courseId: value.slice(0, separator),
    cycleNo: Number.isInteger(cycleNo) && cycleNo >= 0 ? cycleNo : 0,
  };
}

/** 0=全サイクルを、shifts に書き込める有効な便番号へ展開する。 */
export function expandShiftImportCourseChoice(
  choice: ShiftImportCourseChoice,
  course: ShiftImportCourseWithCycles | undefined,
): ShiftImportCourseChoice[] {
  if (!course?.uses_cycles || choice.cycleNo !== 0) return [choice];
  return (course.course_cycles ?? [])
    .filter((cycle) => cycle.active !== false)
    .map((cycle) => ({ courseId: choice.courseId, cycleNo: cycle.cycle_no }));
}
