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

// ============================================================
// ルール＋柔軟な提出期間（migration 075）。
//   ルール = 名前 ＋ 「提出期間」のリスト。各期間 = 日範囲＋締切(オフセット,日)。
//   割り当て済みドライバーはルールの期間で締切判定。未割り当て＝ルールなし＝常にオープン。
// ============================================================

/** 1つの提出期間（日範囲＋締切）。 */
export type RulePeriod = {
  seq: number;
  startDay: number; // 1-31
  endDay: number; // 1-31（月末超過は実行時に当月末へクランプ）
  deadlineMonthOffset: number; // 前月=-1, 当月=0, 翌月=1
  deadlineDay: number; // 1-28 目安
};

/** ルール固有の期間例外（年×月×period の締切上書き）。 */
export type RulePeriodOverride = {
  targetYear: number;
  targetMonth: number; // 1-12
  periodSeq: number;
  deadlineDate: string; // "YYYY-MM-DD"
  note?: string | null;
};

/** 締切ルール。 */
export type DeadlineRule = {
  id: string;
  name: string;
  periods: RulePeriod[];
  overrides: RulePeriodOverride[];
};

/** 解決後の提出期間の状態（ドライバー向け）。 */
export type PeriodStatus = {
  seq: number;
  label: string; // "1〜15" 等
  deadline: string; // "YYYY-MM-DD"
  closed: boolean;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
};

/** 期間の締切日 "YYYY-MM-DD"。期間例外があれば最優先。 */
export function rulePeriodDeadline(
  period: RulePeriod,
  overrides: RulePeriodOverride[],
  year: number,
  month: number,
): string {
  const ov = overrides.find(
    (o) => o.targetYear === year && o.targetMonth === month && o.periodSeq === period.seq,
  );
  if (ov) return ov.deadlineDate;
  const { year: dy, month: dm } = shiftMonth(year, month, period.deadlineMonthOffset);
  return `${dy}-${pad(dm)}-${pad(period.deadlineDay)}`;
}

/**
 * 対象月(1-12)の、ルールの各提出期間の状態。
 * rule=null（未割り当て）や期間が無い場合は空配列＝常にオープン（どの日もロックしない）。
 */
export function monthPeriods(
  rule: DeadlineRule | null,
  year: number,
  month: number,
  todayStr: string,
): PeriodStatus[] {
  if (!rule || rule.periods.length === 0) return [];
  const last = lastDayOfMonth(year, month);
  const mm = pad(month);
  return [...rule.periods]
    .sort((a, b) => a.seq - b.seq)
    .map((p) => {
      const start = Math.max(1, Math.min(p.startDay, last));
      const end = Math.max(start, Math.min(p.endDay, last));
      const deadline = rulePeriodDeadline(p, rule.overrides, year, month);
      return {
        seq: p.seq,
        label: `${start}〜${end}`,
        deadline,
        closed: isClosed(deadline, todayStr),
        startDate: `${year}-${mm}-${pad(start)}`,
        endDate: `${year}-${mm}-${pad(end)}`,
      };
    });
}
