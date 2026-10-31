export function selectedShortageCount(
  selectedLaneIds: string[],
  shortageForLane: (laneId: string) => number,
): number {
  return selectedLaneIds.reduce((total, laneId) => total + Math.max(0, shortageForLane(laneId)), 0);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function exportDateRangeFromColumns(
  selectionX: number,
  selectionWidth: number,
  labelWidth: number,
  dayWidth: number,
  dates: string[],
): { start: string; end: string } {
  if (dates.length === 0) return { start: "", end: "" };
  const firstIndex = Math.max(0, Math.min(dates.length - 1, Math.floor((selectionX - labelWidth) / dayWidth)));
  const lastIndex = Math.max(0, Math.min(dates.length - 1, Math.floor((selectionX + selectionWidth - labelWidth - 1) / dayWidth)));
  return { start: dates[firstIndex] ?? "", end: dates[lastIndex] ?? "" };
}

function fullDateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日（${WEEKDAYS[value.getDay()]}）`;
}

export function exportDateLabel(start: string, end: string): string {
  if (!start || !end) return "シフトメモ";
  if (start === end) return fullDateLabel(start);
  const startValue = new Date(`${start}T12:00:00`);
  const endValue = new Date(`${end}T12:00:00`);
  if (startValue.getFullYear() === endValue.getFullYear() && startValue.getMonth() === endValue.getMonth()) {
    return `${fullDateLabel(start)}〜${endValue.getDate()}日（${WEEKDAYS[endValue.getDay()]}）`;
  }
  return `${fullDateLabel(start)}〜${fullDateLabel(end)}`;
}

export function exportPeriodLabel(dates: string[]): string {
  const first = dates[0];
  if (!first) return "";
  const value = new Date(`${first}T12:00:00`);
  return `${value.getFullYear()}年${value.getMonth() + 1}月 ${value.getDate() <= 15 ? "前半" : "後半"}`;
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

/** エクスポート中の見出しクリックを、配置を書き換えず出力矩形へ変換する。 */
export function exportRangeFromHeader(
  rows: (ExportBodyRow & { laneId: string })[], dates: readonly string[], labelWidth: number, dayWidth: number,
  target: { kind: "column" | "row" | "course"; key: string },
) {
  const selected = target.kind === "column" ? rows : rows.filter(row => target.kind === "row" ? row.laneId === target.key : row.routeId === target.key);
  const dayIndex = target.kind === "column" ? dates.indexOf(target.key) : 0;
  if (selected.length === 0 || dates.length === 0 || dayIndex < 0) return null;
  const first = selected[0], last = selected.at(-1)!;
  return {
    x: labelWidth + dayIndex * dayWidth, y: first.top,
    width: target.kind === "column" ? dayWidth : dayWidth * dates.length,
    height: last.bottom - first.top,
    laneIds: selected.map(row => row.laneId), routeIds: [...new Set(selected.map(row => row.routeId).filter(Boolean))],
  };
}
