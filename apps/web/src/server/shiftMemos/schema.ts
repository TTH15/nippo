export const SHIFT_MEMO_MAX_DAYS = 31;
export const SHIFT_MEMO_MAX_PLACEMENTS_PER_DAY = 300;
export const SHIFT_MEMO_MAX_LABEL_LENGTH = 40;
export const SHIFT_MEMO_MAX_NOTE_LENGTH = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEMENT_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export type ShiftMemoPlacement = {
  id: string;
  courseId: string;
  cycleNo: number;
  driverId: string | null;
  label: string;
};

export type ShiftMemoDay = {
  date: string;
  placements: ShiftMemoPlacement[];
  note: string;
  updatedAt?: string | null;
};

type ParseOptions = {
  allowedCourseIds?: ReadonlySet<string>;
  allowedDriverIds?: ReadonlySet<string>;
};

type ParseResult =
  | { ok: true; days: ShiftMemoDay[] }
  | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isValidMemoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseShiftMemoDays(raw: unknown, options: ParseOptions = {}): ParseResult {
  if (!Array.isArray(raw)) return { ok: false, message: "days must be an array" };
  if (raw.length > SHIFT_MEMO_MAX_DAYS) {
    return { ok: false, message: `一度に保存できるのは${SHIFT_MEMO_MAX_DAYS}日分までです` };
  }

  const seenDates = new Set<string>();
  const days: ShiftMemoDay[] = [];
  for (const rawDay of raw) {
    if (!isObject(rawDay) || !isValidMemoDate(rawDay.date)) {
      return { ok: false, message: "日付が不正です" };
    }
    if (seenDates.has(rawDay.date)) return { ok: false, message: "同じ日付が重複しています" };
    seenDates.add(rawDay.date);

    const note = typeof rawDay.note === "string" ? rawDay.note : "";
    if (note.length > SHIFT_MEMO_MAX_NOTE_LENGTH) {
      return { ok: false, message: `メモは${SHIFT_MEMO_MAX_NOTE_LENGTH}文字以内で入力してください` };
    }
    if (!Array.isArray(rawDay.placements)) {
      return { ok: false, message: "placements must be an array" };
    }
    if (rawDay.placements.length > SHIFT_MEMO_MAX_PLACEMENTS_PER_DAY) {
      return {
        ok: false,
        message: `1日に置ける札は${SHIFT_MEMO_MAX_PLACEMENTS_PER_DAY}件までです`,
      };
    }

    const seenPlacementIds = new Set<string>();
    const placements: ShiftMemoPlacement[] = [];
    for (const rawPlacement of rawDay.placements) {
      if (!isObject(rawPlacement)) return { ok: false, message: "名前札が不正です" };
      const id = typeof rawPlacement.id === "string" ? rawPlacement.id : "";
      const courseId = typeof rawPlacement.courseId === "string" ? rawPlacement.courseId : "";
      const driverId = rawPlacement.driverId == null ? null : rawPlacement.driverId;
      const label = typeof rawPlacement.label === "string" ? rawPlacement.label.trim() : "";
      const cycleNo = Number(rawPlacement.cycleNo ?? 0);

      if (!PLACEMENT_ID_RE.test(id) || seenPlacementIds.has(id)) {
        return { ok: false, message: "名前札のIDが不正または重複しています" };
      }
      seenPlacementIds.add(id);
      if (!UUID_RE.test(courseId) || options.allowedCourseIds?.has(courseId) === false) {
        return { ok: false, message: "コースが不正です" };
      }
      if (
        driverId !== null &&
        (typeof driverId !== "string" ||
          !UUID_RE.test(driverId) ||
          options.allowedDriverIds?.has(driverId) === false)
      ) {
        return { ok: false, message: "ドライバーが不正です" };
      }
      if (!Number.isInteger(cycleNo) || cycleNo < 0 || cycleNo > 99) {
        return { ok: false, message: "便番号が不正です" };
      }
      if (!label || label.length > SHIFT_MEMO_MAX_LABEL_LENGTH) {
        return {
          ok: false,
          message: `名前札は1〜${SHIFT_MEMO_MAX_LABEL_LENGTH}文字で入力してください`,
        };
      }
      placements.push({ id, courseId, cycleNo, driverId, label });
    }
    days.push({ date: rawDay.date, placements, note });
  }
  return { ok: true, days };
}

export function isMemoRangeValid(start: string, end: string): boolean {
  if (!isValidMemoDate(start) || !isValidMemoDate(end) || start > end) return false;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1 <= SHIFT_MEMO_MAX_DAYS;
}

