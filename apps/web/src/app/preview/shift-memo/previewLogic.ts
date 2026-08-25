export function findDuplicateCourseIds(
  assignments: Record<string, string[]>,
  courseIds: string[],
  targetDay: number,
  personName: string,
  sourceKey?: string,
): string[] {
  let skippedSource = false;

  return courseIds.filter((courseId) => {
    const key = `${courseId}:${targetDay}`;
    const matches = (assignments[key] ?? []).filter((name) => name === personName).length;
    if (matches === 0) return false;

    if (!skippedSource && sourceKey === key) {
      skippedSource = true;
      return matches > 1;
    }

    return true;
  });
}

export function assignedPersonCount(people: string[]): number {
  return new Set(people).size;
}

export function shortageCount(active: boolean, requiredCount: number, people: string[]): number {
  if (!active) return 0;
  return Math.max(0, requiredCount - assignedPersonCount(people));
}
