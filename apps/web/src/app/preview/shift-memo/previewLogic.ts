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

export function selectedShortageCount(
  selectedCourseIds: string[],
  shortageForCourse: (courseId: string) => number,
): number {
  return selectedCourseIds.reduce((total, courseId) => total + Math.max(0, shortageForCourse(courseId)), 0);
}

export function exportEdgeVelocity(
  position: number,
  start: number,
  end: number,
  edgeSize = 58,
  maxSpeed = 18,
): number {
  if (position < start + edgeSize) {
    const intensity = Math.min(1, Math.max(0, (start + edgeSize - position) / edgeSize));
    return -Math.ceil(2 + maxSpeed * intensity);
  }
  if (position > end - edgeSize) {
    const intensity = Math.min(1, Math.max(0, (position - (end - edgeSize)) / edgeSize));
    return Math.ceil(2 + maxSpeed * intensity);
  }
  return 0;
}

export type ExportBodyRow = { top: number; bottom: number; routeId: string };
export type ExportRouteHeader = { routeId: string; top: number; bottom: number };
export type ExportBodySlice = { top: number; bottom: number; routeId: string; kind: "route" | "row" };

export function exportBodySlices(
  rows: ExportBodyRow[],
  headers: ExportRouteHeader[],
  selectionTop: number,
  selectionBottom: number,
): ExportBodySlice[] {
  const headerByRouteId = new Map(headers.map(({ routeId, top, bottom }) => [routeId, { top, bottom }]));
  const selectedRows = rows.filter((row) => row.bottom > selectionTop && row.top < selectionBottom);
  const slices: ExportBodySlice[] = [];
  let currentRouteId = "";

  selectedRows.forEach((row) => {
    if (row.routeId !== currentRouteId) {
      const header = headerByRouteId.get(row.routeId);
      if (header) slices.push({ ...header, routeId: row.routeId, kind: "route" });
      currentRouteId = row.routeId;
    }
    slices.push({ top: row.top, bottom: row.bottom, routeId: row.routeId, kind: "row" });
  });

  return slices;
}
