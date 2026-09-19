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
