import { readRequiredCountOverrides, type DayOverride } from "./board";

export type TransferLane = {
  id: string;
  routeId: string;
  name: string;
  color: string;
  activeWeekdays: number[];
  requiredCount: number;
  custom: boolean;
  reflectCourseId?: string;
};
export type TransferPerson = { placementId: string; personKey: string; driverId?: string; name: string };
export type ShiftMemoBoardData = {
  version: 1;
  lanes: TransferLane[];
  laneOrder: string[];
  hiddenLaneIds: string[];
  assignments: Record<string, TransferPerson[]>;
  extraPeople: string[];
  notes: Record<string, string>;
  dayOverrides?: Record<string, DayOverride>;
  requiredCountOverrides?: Record<string, number>;
  routeOrder?: string[];
  hiddenRouteIds?: string[];
  widths?: { day: number; lane: number; detail: number };
};

const FORMAT = "hakotora-shift-memo";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const dateKey = /^(.+)\|(\d{4}-\d{2}-\d{2})$/;

export function exportShiftMemo(board: ShiftMemoBoardData): string {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), board }, null, 2);
}

/** 表計算で確認するためのCSV。完全な復元にはJSONを使う。 */
export function exportShiftMemoCsv(board: ShiftMemoBoardData, courses: readonly { id: string; name: string }[], dates?: readonly string[]): string {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [["日付", "コース", "担当枠", "名前", "必要人数", "備考"]];
  const lanes = new Map(board.lanes.map(lane => [lane.id, lane]));
  const laneIds = [...new Set([...board.laneOrder, ...board.lanes.map(lane => lane.id)])];
  const keys = dates?.flatMap(date => laneIds.map(id => `${id}|${date}`)) ?? Object.keys(board.assignments).sort();
  for (const key of keys) {
    const people = board.assignments[key] ?? [];
    const [laneId, date] = key.split("|");
    const lane = lanes.get(laneId);
    if (!lane) continue;
    const course = courses.find(item => item.id === lane.routeId)?.name ?? lane.name;
    const names = people.length ? people.map(person => person.name) : [""];
    for (const name of names) rows.push([date, course, lane.name, name,
      String(board.requiredCountOverrides?.[key] ?? lane.requiredCount), board.notes[date] ?? ""]);
  }
  return `\uFEFF${rows.map(row => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** 受領ファイルは端末内だけで解析する。別会社のコースIDを含む盤面は読み込まない。 */
export function parseShiftMemoTransfer(
  text: string,
  context: { courseIds: readonly string[]; driverIds: readonly string[] },
): { board: ShiftMemoBoardData; unregisteredNames: string[]; placementCount: number } {
  let root: unknown;
  try { root = JSON.parse(text); } catch { throw new Error("メモのデータファイルを読み取れませんでした"); }
  if (!object(root) || root.format !== FORMAT || root.version !== 1 || !object(root.board)) {
    throw new Error("ハコ虎のシフトメモデータを選んでください");
  }
  const source = root.board;
  if (source.version !== 1 || !Array.isArray(source.lanes) || source.lanes.length > 500 ||
      !strings(source.laneOrder) || !strings(source.hiddenLaneIds) ||
      !strings(source.extraPeople) || source.extraPeople.length > 500 ||
      !object(source.assignments) || !object(source.notes)) {
    throw new Error("メモのデータが壊れています");
  }
  const courseIds = new Set(context.courseIds);
  const driverIds = new Set(context.driverIds);
  const lanes: TransferLane[] = source.lanes.map((value) => {
    if (!object(value) || typeof value.id !== "string" || !value.id ||
      typeof value.routeId !== "string" || !courseIds.has(value.routeId) ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
      typeof value.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.color) ||
      !Array.isArray(value.activeWeekdays) || value.activeWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      !Number.isInteger(value.requiredCount) || (value.requiredCount as number) < 0 || (value.requiredCount as number) > 1000 ||
      typeof value.custom !== "boolean" ||
      (value.reflectCourseId !== undefined && (typeof value.reflectCourseId !== "string" || !courseIds.has(value.reflectCourseId)))) {
      throw new Error("このメモには、現在使えないコースや担当枠が含まれています");
    }
    return value as TransferLane;
  });
  const laneIds = new Set(lanes.map((lane) => lane.id));
  if (laneIds.size !== lanes.length || source.laneOrder.some((id) => !laneIds.has(id)) || source.hiddenLaneIds.some((id) => !laneIds.has(id))) {
    throw new Error("メモの担当枠の並びが壊れています");
  }
  const assignments: Record<string, TransferPerson[]> = {};
  const unregisteredNames = new Set<string>();
  let placementCount = 0;
  for (const [key, value] of Object.entries(source.assignments)) {
    const match = key.match(dateKey);
    if (!match || !laneIds.has(match[1]) || !Array.isArray(value)) throw new Error("メモの配置が壊れています");
    const date = new Date(`${match[2]}T12:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[2]) throw new Error("メモの日付が壊れています");
    const people: TransferPerson[] = [];
    for (const item of value) {
      if (!object(item) || typeof item.placementId !== "string" || !item.placementId ||
        typeof item.personKey !== "string" || !item.personKey ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 ||
        (item.driverId !== undefined && typeof item.driverId !== "string")) {
        throw new Error("メモの名前札が壊れています");
      }
      const person = item as TransferPerson;
      if (person.driverId && !driverIds.has(person.driverId)) {
        people.push({ placementId: person.placementId, personKey: person.personKey, name: person.name });
        unregisteredNames.add(person.name);
      } else {
        people.push(person);
        if (!person.driverId) unregisteredNames.add(person.name);
      }
      placementCount++;
      if (placementCount > 10000) throw new Error("メモの配置が多すぎます");
    }
    assignments[key] = people;
  }
  const notes: Record<string, string> = {};
  for (const [key, value] of Object.entries(source.notes)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || typeof value !== "string" || value.length > 5000) {
      throw new Error("メモの備考が壊れています");
    }
    notes[key] = value;
  }
  if (source.extraPeople.some((name) => !name.trim() || name.length > 80)) throw new Error("メモの名前札が壊れています");
  const routeOrder = strings(source.routeOrder) ? source.routeOrder.filter((id) => courseIds.has(id)) : [];
  const hiddenRouteIds = strings(source.hiddenRouteIds) ? source.hiddenRouteIds.filter((id) => courseIds.has(id)) : [];
  const dayOverrides: Record<string, DayOverride> = {};
  if (object(source.dayOverrides)) {
    for (const [key, value] of Object.entries(source.dayOverrides)) {
      if (dateKey.test(key) && laneIds.has(key.match(dateKey)![1]) && (value === "on" || value === "off")) dayOverrides[key] = value;
    }
  }
  const board: ShiftMemoBoardData = {
    version: 1, lanes, laneOrder: source.laneOrder, hiddenLaneIds: source.hiddenLaneIds,
    assignments, extraPeople: source.extraPeople, notes, dayOverrides,
    requiredCountOverrides: readRequiredCountOverrides(source.requiredCountOverrides),
    routeOrder, hiddenRouteIds,
    widths: object(source.widths) && [source.widths.day, source.widths.lane, source.widths.detail].every((n) => typeof n === "number" && Number.isFinite(n))
      ? source.widths as ShiftMemoBoardData["widths"] : undefined,
  };
  return { board, unregisteredNames: [...unregisteredNames], placementCount };
}
