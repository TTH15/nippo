// ============================================================
// シフトメモ（個人の下書き盤）の純粋ロジック。
//
// メモ盤は端末ごとの下書き。正式シフトへの反映は、対象・差分を確認する専用操作だけで行う。
// 稼働・必要人数・希望休の判定をまとめ、表と日別配置・出力でそろえる。
// ============================================================

/** 担当枠×日の例外指定。曜日の設定より優先する */
export type DayOverride = "off" | "on";

/** 担当枠×日のキー。`assignments` と同じ形にそろえる */
export const cellKey = (laneId: string, date: string): string => `${laneId}|${date}`;

export const MAX_REQUIRED_COUNT = 10;

function isRequiredCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_REQUIRED_COUNT;
}

/** 旧データには例外が無い。不正値だけを落とし、別の月や非表示の枠の指定は残す。 */
export function readRequiredCountOverrides(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, count]) =>
    /^.+\|\d{4}-\d{2}-\d{2}$/.test(key) && isRequiredCount(count),
  ));
}

/** 0人も有効な指定。休みの設定とは独立し、配置済みの人を減らさない。 */
export function resolveDayStaffing(normalCount: number, override: number | undefined, active: boolean, assigned: number) {
  const requiredCount = isRequiredCount(override) ? override : normalCount;
  return { requiredCount, shortage: active ? Math.max(0, requiredCount - assigned) : 0 };
}

/** 通常へ戻す操作／通常と同じ人数の反映は、その日の人数指定だけを消す。 */
export function updateRequiredCountOverride(
  current: Record<string, number>, key: string, normalCount: number, wanted: number | null,
): Record<string, number> {
  if (wanted !== null && !isRequiredCount(wanted)) return current;
  const next = { ...current };
  if (wanted === null || wanted === normalCount) delete next[key];
  else next[key] = wanted;
  return next;
}

export type DayActivity = {
  /** その日にその枠が動くか */
  active: boolean;
  /** 曜日の設定ではなく、その日だけの例外で決まっているか */
  spot: boolean;
};

/**
 * 曜日の設定に、その日だけの例外を重ねて「動くかどうか」を決める。
 * 例外が曜日の設定と同じ向きなら、例外は無いものとして扱う（印を出さない）。
 */
export function resolveDayActivity(
  activeWeekdays: readonly number[],
  weekdayNo: number,
  override: DayOverride | undefined,
): DayActivity {
  const byWeekday = activeWeekdays.includes(weekdayNo);
  if (!override) return { active: byWeekday, spot: false };
  const active = override === "on";
  return { active, spot: active !== byWeekday };
}

/**
 * 「この日だけ休み／稼働」を押したときの次の例外指定。
 * 曜日の設定に戻るときは undefined を返し、キーごと捨てる（余計な保存を残さない）。
 */
export function nextDayOverride(
  activeWeekdays: readonly number[],
  weekdayNo: number,
  override: DayOverride | undefined,
): DayOverride | undefined {
  const { active } = resolveDayActivity(activeWeekdays, weekdayNo, override);
  const wanted: DayOverride = active ? "off" : "on";
  return activeWeekdays.includes(weekdayNo) === (wanted === "on") ? undefined : wanted;
}

/** セルの右上に出す文言。null = 不足数や人数を出す（呼び出し側の判断） */
export function activityLabel(activity: DayActivity): string | null {
  if (!activity.active) return activity.spot ? "臨時休" : "非稼働";
  return activity.spot ? "臨時稼働" : null;
}

export type ShiftRequestLike = {
  driver_id: string;
  request_date: string;
  /** 便（時間帯）。null = 全休 */
  slot_id: string | null;
};

/**
 * 日付 → その日に**全休**の希望を出しているドライバー。
 * 便指定の休み希望は「その日は働ける」ので入れない（正式シフト表と同じ扱い）。
 */
export function fullDayOffByDate(requests: readonly ShiftRequestLike[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const request of requests) {
    if (request.slot_id != null) continue;
    const set = map.get(request.request_date) ?? new Set<string>();
    set.add(request.driver_id);
    map.set(request.request_date, set);
  }
  return map;
}


export const MEMO_BACKGROUND_COLORS = [
  { value: "none", label: "色なし", color: "#ffffff" },
  { value: "yellow", label: "黄", color: "#fef3c7" },
  { value: "rose", label: "赤", color: "#ffe4e6" },
  { value: "sky", label: "青", color: "#dbeafe" },
  { value: "green", label: "緑", color: "#dcfce7" },
  { value: "violet", label: "紫", color: "#ede9fe" },
] as const;
export type MemoBackground = typeof MEMO_BACKGROUND_COLORS[number]["value"];
export const isMemoBackgroundKey = (key: string) => key.length <= 200 && /^(weekday:[0-6]|date:\d{4}-\d{2}-\d{2}|row:.+|course:.+|cell:.+\|\d{4}-\d{2}-\d{2})$/.test(key);
export const isMemoBackground = (value: unknown): value is MemoBackground => MEMO_BACKGROUND_COLORS.some(item => item.value === value);
export function readBackgroundColors(value: unknown): Record<string, MemoBackground> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key,color]) => isMemoBackgroundKey(key) && isMemoBackground(color))) as Record<string, MemoBackground>;
}
/** セル > 担当枠 > コース > 日付 > 曜日。色なしも明示指定として扱う。 */
export function memoBackgroundColor(colors: Record<string, MemoBackground>, date?: string, laneId?: string, routeId?: string): string | undefined {
  const value = (date && laneId ? colors[`cell:${cellKey(laneId,date)}`] : undefined)
    ?? (laneId ? colors[`row:${laneId}`] : undefined)
    ?? (routeId ? colors[`course:${routeId}`] : undefined)
    ?? (date ? colors[`date:${date}`] ?? colors[`weekday:${new Date(`${date}T12:00:00`).getDay()}`] : undefined);
  return MEMO_BACKGROUND_COLORS.find(item => item.value === value)?.color;
}
/** 非表示は表示設定だけ。全コースの稼働枠にある配置を日付で重複排除する。 */
export function memoWorkDays(
  lanes: readonly { id: string; activeWeekdays: number[] }[],
  assignments: Record<string, readonly { personKey: string; driverId?: string; name: string }[]>,
  dates: readonly string[], dayOverrides: Record<string, DayOverride>,
): Map<string, { name: string; days: number }> {
  const days = new Map<string, { name: string; dates: Set<string> }>();
  for (const date of dates) for (const lane of lanes) {
    const key = cellKey(lane.id,date);
    if (!resolveDayActivity(lane.activeWeekdays,new Date(`${date}T12:00:00`).getDay(),dayOverrides[key]).active) continue;
    for (const person of assignments[key] ?? []) {
      const id = person.driverId ? `driver:${person.driverId}` : person.personKey;
      const entry = days.get(id) ?? { name: person.name, dates: new Set<string>() };
      entry.dates.add(date);days.set(id,entry);
    }
  }
  return new Map([...days].map(([key,entry]) => [key,{ name: entry.name, days: entry.dates.size }]));
}


/** 行・列の交差は最後に塗った範囲に合わせ、範囲外の設定は維持する。 */
export function paintMemoBackground(
  colors: Record<string, MemoBackground>, key: string, value: MemoBackground | null,
  lanes: readonly {id: string; routeId: string}[], dates: readonly string[],
): Record<string, MemoBackground> {
  if (!isMemoBackgroundKey(key)) return colors;
  const next = {...colors};
  if (value === null) delete next[key];else next[key] = value;
  if (key.startsWith("date:")) {
    const date = key.slice(5);
    for (const lane of lanes) {
      const cell = `cell:${cellKey(lane.id,date)}`;
      if(value === null) delete next[cell];
      else if (next[cell] || next[`row:${lane.id}`] || next[`course:${lane.routeId}`]) next[cell] = value;
    }
  } else if (key.startsWith("row:") || key.startsWith("course:")) {
    const selected = lanes.filter(lane => key === `row:${lane.id}` || key === `course:${lane.routeId}`);
    for (const lane of selected) {
      if(key.startsWith("course:")) delete next[`row:${lane.id}`];
      for (const date of dates) delete next[`cell:${cellKey(lane.id,date)}`];
    }
  }
  return next;
}


/** 未配置の表示用一覧。非表示の枠も確認し、driverIdで旧personKeyを同一人物として扱う。 */
export function memoUnassignedPeople<T extends { personKey: string; driverId?: string }>(
  candidates: readonly T[], lanes: readonly { id: string }[],
  assignments: Record<string, readonly { personKey: string; driverId?: string }[]>,
  dates: readonly string[], hiddenPeople: Record<string, true>,
): Map<string, T[]> {
  const visible = candidates.filter(person => !hiddenPeople[person.personKey]);
  return new Map(dates.map(date => {
    const keys = new Set<string>();
    const driverIds = new Set<string>();
    for (const lane of lanes) for (const person of assignments[cellKey(lane.id, date)] ?? []) {
      keys.add(person.personKey);
      if (person.driverId) driverIds.add(person.driverId);
    }
    return [date, visible.filter(person => !keys.has(person.personKey) && !(person.driverId && driverIds.has(person.driverId)))];
  }));
}
