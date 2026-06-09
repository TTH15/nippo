// ============================================================
// 希望休 提出締切の純粋計算（TZ非依存・文字列ベース）。
//   admin / driver / server すべてがここを使い、半月計算を一元化する。
//   日付は必ず文字列 "YYYY-MM-DD" で組み立てる（Date.toISOString() は
//   UTC変換で日ズレするため使わない）。
// ============================================================

export type Half = "FIRST" | "SECOND";

export type DeadlineConfig = {
  firstHalfEndDay: number; // 前半の最終日（既定15）
  firstHalfDeadlineMonthOffset: number; // 前半締切の月オフセット（前月=-1）
  firstHalfDeadlineDay: number; // 前半締切の日（既定23）
  secondHalfDeadlineMonthOffset: number; // 後半締切の月オフセット（当月=0）
  secondHalfDeadlineDay: number; // 後半締切の日（既定10）
};

export type DeadlineOverride = {
  targetYear: number;
  targetMonth: number; // 1-12
  half: Half;
  deadlineDate: string; // "YYYY-MM-DD"
  note?: string | null;
};

export const DEFAULT_DEADLINE_CONFIG: DeadlineConfig = {
  firstHalfEndDay: 15,
  firstHalfDeadlineMonthOffset: -1,
  firstHalfDeadlineDay: 23,
  secondHalfDeadlineMonthOffset: 0,
  secondHalfDeadlineDay: 10,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** その月(1-12)の末日。new Date(year, month, 0) は month月の末日（TZ非依存）。 */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 対象 年×月×半月 の日付範囲 "YYYY-MM-DD"。 */
export function halfRange(
  year: number,
  month: number,
  half: Half,
  firstHalfEndDay: number = DEFAULT_DEADLINE_CONFIG.firstHalfEndDay,
): { start: string; end: string } {
  const mm = pad(month);
  if (half === "FIRST") {
    return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${pad(firstHalfEndDay)}` };
  }
  return {
    start: `${year}-${mm}-${pad(firstHalfEndDay + 1)}`,
    end: `${year}-${mm}-${pad(lastDayOfMonth(year, month))}`,
  };
}

/** 月オフセットを足して年跨ぎを正規化（month は 1-12）。 */
function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  let dm = month + offset;
  let dy = year;
  while (dm <= 0) {
    dm += 12;
    dy -= 1;
  }
  while (dm > 12) {
    dm -= 12;
    dy += 1;
  }
  return { year: dy, month: dm };
}

/** 対象 年×月×半月 の締切日 "YYYY-MM-DD"。override 最優先。 */
export function computeDeadline(
  config: DeadlineConfig,
  overrides: DeadlineOverride[],
  year: number,
  month: number,
  half: Half,
): string {
  const ov = overrides.find(
    (o) => o.targetYear === year && o.targetMonth === month && o.half === half,
  );
  if (ov) return ov.deadlineDate;

  const offset =
    half === "FIRST" ? config.firstHalfDeadlineMonthOffset : config.secondHalfDeadlineMonthOffset;
  const day = half === "FIRST" ? config.firstHalfDeadlineDay : config.secondHalfDeadlineDay;
  const { year: dy, month: dm } = shiftMonth(year, month, offset);
  return `${dy}-${pad(dm)}-${pad(day)}`;
}

/** 締切超過か。締切当日は入力可（inclusive）= todayStr > deadline で closed。 */
export function isClosed(deadline: string, todayStr: string): boolean {
  return todayStr > deadline;
}

export type HalfStatus = {
  half: Half;
  deadline: string;
  closed: boolean;
  startDate: string;
  endDate: string;
};

/** 対象月(1-12)の前半・後半それぞれの締切・ロック状態・日付範囲。 */
export function monthHalves(
  config: DeadlineConfig,
  overrides: DeadlineOverride[],
  year: number,
  month: number,
  todayStr: string,
): { firstHalf: HalfStatus; secondHalf: HalfStatus } {
  const build = (half: Half): HalfStatus => {
    const deadline = computeDeadline(config, overrides, year, month, half);
    const { start, end } = halfRange(year, month, half, config.firstHalfEndDay);
    return { half, deadline, closed: isClosed(deadline, todayStr), startDate: start, endDate: end };
  };
  return { firstHalf: build("FIRST"), secondHalf: build("SECOND") };
}
