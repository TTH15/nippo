type CourseCycles = {
  uses_cycles?: boolean | null;
  course_cycles?: { cycle_no: number; active?: boolean | null }[] | null;
};

/** 現在追加・コピーできる便。過去の割当から編集候補を増やさない。 */
export function activeCourseCycleNos(course: CourseCycles): number[] {
  return course.uses_cycles
    ? (course.course_cycles ?? []).filter(cycle => cycle.active !== false).map(cycle => cycle.cycle_no)
    : [];
}

/** 表示・人数・未割当の走査では、当日の実績便も残す（無効便・旧形式を含む）。 */
export function displayCourseCycleNos(course: CourseCycles, assignedCycleNos: Iterable<number>): number[] {
  const current = course.uses_cycles ? activeCourseCycleNos(course) : [0];
  const assigned = [...assignedCycleNos].sort((a, b) => a - b);
  // 現在便の順序は維持し、旧形式の0だけは従来どおり先頭に置く。
  return [...new Set([...(assigned.includes(0) ? [0] : []), ...current, ...assigned])];
}
