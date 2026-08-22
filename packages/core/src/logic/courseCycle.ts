// ============================================================
// コースの便（cycle）の表示ロジック（純粋関数）。
// 設計: docs/design/course-cycle.md
//
// ★方針: 便が複数あるコースだけバッジを出す。
//   1便しか無いコースに「1便」と出しても情報がなく、画面が煩くなるだけ。
//   データ上は便が存在していても、表示では省略する。
// ============================================================

export type CourseCycle = {
  cycleNo: number;
  /** 任意の表示名。未設定なら「N便」。 */
  label?: string | null;
  meetingPlace?: string | null;
  meetingTime?: string | null;
  arrivalTime?: string | null;
  endTime?: string | null;
  maxDrivers?: number | null;
};

/** 便の表示名。ラベルがあればそれ、無ければ「N便」。 */
export function cycleLabel(cycle: Pick<CourseCycle, "cycleNo" | "label">): string {
  const label = cycle.label?.trim();
  return label ? label : `${cycle.cycleNo}便`;
}

/**
 * バッジを出すべきか。
 * 便が2つ以上あるコースだけ出す（1便しか無いなら区別する必要がない）。
 */
export function shouldShowCycleBadge(cycles: { cycleNo: number }[] | null | undefined): boolean {
  return (cycles?.length ?? 0) >= 2;
}

/**
 * シフト1件に添える便バッジ。出さないときは null。
 *   - コースが便を使っていない → null
 *   - 便が1つしかない → null（区別の必要がない）
 *   - 便が未設定（cycleNo=0）→ null（移行期の状態。バッジではなく別途「便未設定」として扱う）
 */
export function badgeForShift(
  cycleNo: number | null | undefined,
  cycles: CourseCycle[] | null | undefined,
): string | null {
  if (!cycleNo || cycleNo < 1) return null;
  if (!shouldShowCycleBadge(cycles)) return null;
  const cycle = cycles?.find((c) => c.cycleNo === cycleNo);
  return cycle ? cycleLabel(cycle) : `${cycleNo}便`;
}

/**
 * 同じコースの、その日の割当をまとめて表示するときに便バッジが必要か。
 * 全サイクルが揃っている状態を通常表示（コース名だけ）とし、一部だけの割当を特殊表示する。
 * マスターに無い便番号が含まれる場合は、異常を隠さないためバッジを残す。
 */
export function shouldShowCycleBadgesForSelection(
  selectedCycleNos: number[] | null | undefined,
  availableCycleNos: number[] | null | undefined,
): boolean {
  const selected = new Set((selectedCycleNos ?? []).filter((cycleNo) => Number.isInteger(cycleNo) && cycleNo >= 1));
  if (selected.size === 0) return false;

  const available = new Set((availableCycleNos ?? []).filter((cycleNo) => Number.isInteger(cycleNo) && cycleNo >= 1));
  if (available.size === 0 || selected.size !== available.size) return true;
  return [...selected].some((cycleNo) => !available.has(cycleNo));
}

export type CourseTimes = {
  meetingPlace?: string | null;
  meetingTime?: string | null;
  arrivalTime?: string | null;
  endTime?: string | null;
};

/**
 * その日の実効的な時間・場所を解決する。
 *
 *   サイクル未使用: shifts.* ?? courses.*        （従来どおり）
 *   サイクル使用中: shifts.* ?? course_cycles.* ?? courses.*
 *
 * 「サイクルを使う」場合は時間の主が便に移る、という設計に対応する。
 * どの段でも未設定なら null（呼び出し側で行ごと落とす）。
 */
export function resolveCourseTimes(input: {
  shift?: CourseTimes | null;
  cycle?: CourseTimes | null;
  course?: CourseTimes | null;
  usesCycles?: boolean;
}): CourseTimes {
  const layers: (CourseTimes | null | undefined)[] = input.usesCycles
    ? [input.shift, input.cycle, input.course]
    : [input.shift, input.course];

  const pick = (key: keyof CourseTimes): string | null => {
    for (const layer of layers) {
      const value = layer?.[key];
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  };

  return {
    meetingPlace: pick("meetingPlace"),
    meetingTime: pick("meetingTime"),
    arrivalTime: pick("arrivalTime"),
    endTime: pick("endTime"),
  };
}

/** 便を追加するときの次の番号（欠番があっても最大+1。番号の使い回しをしない）。 */
export function nextCycleNo(cycles: { cycleNo: number }[]): number {
  if (cycles.length === 0) return 1;
  return Math.max(...cycles.map((c) => c.cycleNo)) + 1;
}
