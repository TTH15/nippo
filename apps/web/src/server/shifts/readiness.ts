// ============================================================
// 締切より前に「予定が合っていない場所」を集める（純粋ロジック）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// ここが答えるのは1つだけ: **いま手を打たないと当日に事故になるのはどれか**。
//
// 方針:
//   - 状態から毎回導く。閉じた・見たという印は持たない（一度閉じても解決するまで消えない）
//   - 空白を「休み」「未入力」「人数未確定」に分ける。未確定を正常扱いしない
//   - 配置が1件も無い日でも、必要人数の基準があるので不足として出る
//   - 本人の確認は「その版に対する確認」。版が変われば確認は無効に戻る
//   - 原本との照合は取り込み時の抽出結果が相手。同じ誤読は通るので、
//     原本そのものとの独立した確認を置き換えない（設計 O-1 の注記）
//
// 解消の期限は会社ごとの設定（readinessSettings.ts）。既定値は 3/2/1 日前。
// ============================================================
import { dueDaysFor, DEFAULT_READINESS_SETTINGS, type ReadinessSettings } from "./readinessSettings";

/** working=動く / closed=その日は動かない / undecided=人数がまだ決まっていない */
export type StaffingState = "working" | "closed" | "undecided";

export type StaffingBaseline = {
  courseId: string;
  cycleNo: number;
  /** 0=日曜 … 6=土曜 */
  weekday: number;
  state: "working" | "closed";
  requiredCount: number | null;
};

export type StaffingRequirement = {
  date: string;
  courseId: string;
  cycleNo: number;
  state: StaffingState;
  requiredCount: number | null;
};

export type ShiftAssignment = {
  date: string;
  courseId: string;
  cycleNo: number;
  driverId: string | null;
  vehicleId: string | null;
  usesExternalVehicle: boolean;
};

export type PlanConfirmation = {
  driverId: string;
  date: string;
  planVersion: string;
  response: "confirmed" | "unavailable";
};

/** 本人ごとの「いまの予定の版」。予定が無い日は渡さない */
export type DriverPlan = { driverId: string; date: string; planVersion: string };

/** 会社が動かす枠（コース×便）。便を使わないコースは cycleNo=0 の1枠 */
export type CourseFrame = { courseId: string; courseName: string; cycleNo: number; cycleLabel: string | null };

/** 取り込み原本から読み取った配置（照合の相手） */
export type SourceExtract = { date: string; courseId: string; cycleNo: number; driverIds: string[] };

export type UnresolvedKind =
  | "baseline_missing"
  | "undecided"
  | "shortage"
  | "assigned_on_closed"
  | "unavailable"
  | "stale_confirmation"
  | "unconfirmed"
  | "source_mismatch"
  | "no_vehicle";

export type UnresolvedItem = {
  kind: UnresolvedKind;
  /** 枠そのものの問題（basline_missing）は日付を持たない */
  date: string | null;
  courseId: string | null;
  cycleNo: number | null;
  driverId: string | null;
  /** この日までに直す。null = 期限を決められない（枠の設定漏れ） */
  dueDate: string | null;
  severity: "high" | "medium";
  /** 画面に出す短い事実。原因の説明や操作の言い直しは入れない */
  detail: string;
};

/** 重い順。同じ日付なら、この順で上に出す */
const KIND_ORDER: UnresolvedKind[] = [
  "unavailable",
  "shortage",
  "assigned_on_closed",
  "source_mismatch",
  "stale_confirmation",
  "undecided",
  "unconfirmed",
  "no_vehicle",
  "baseline_missing",
];

const HIGH: UnresolvedKind[] = [
  "unavailable",
  "shortage",
  "assigned_on_closed",
  "source_mismatch",
  "stale_confirmation",
  "undecided",
];

const frameKey = (courseId: string, cycleNo: number) => `${courseId}|${cycleNo}`;
const dayKey = (date: string, courseId: string, cycleNo: number) => `${date}|${courseId}|${cycleNo}`;
const driverDayKey = (driverId: string, date: string) => `${driverId}|${date}`;

/** YYYY-MM-DD を n 日戻す。JST の日付文字列だけを扱うので UTC 正午で計算する */
export function shiftDate(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return date;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** 0=日曜 … 6=土曜 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export type ResolvedStaffing = {
  state: StaffingState;
  requiredCount: number | null;
  /** date=その日の指定 / baseline=曜日の基準 / none=どちらも無い */
  from: "date" | "baseline" | "none";
};

/**
 * その日その枠の必要人数を決める。日付の指定が最優先で、無ければ曜日の基準。
 * どちらも無ければ「未入力」であり、休みとして扱わない。
 */
export function resolveStaffing(
  date: string,
  courseId: string,
  cycleNo: number,
  requirements: ReadonlyMap<string, StaffingRequirement>,
  baselines: ReadonlyMap<string, StaffingBaseline>,
): ResolvedStaffing {
  const byDate = requirements.get(dayKey(date, courseId, cycleNo));
  if (byDate) return { state: byDate.state, requiredCount: byDate.requiredCount, from: "date" };
  const baseline = baselines.get(`${frameKey(courseId, cycleNo)}|${weekdayOf(date)}`);
  if (baseline) return { state: baseline.state, requiredCount: baseline.requiredCount, from: "baseline" };
  return { state: "undecided", requiredCount: null, from: "none" };
}

export type ReadinessInput = {
  /** 見る日（当日以降を昇順で）。どこまで先を見るかは呼び出し側が決める */
  dates: readonly string[];
  frames: readonly CourseFrame[];
  baselines: readonly StaffingBaseline[];
  requirements: readonly StaffingRequirement[];
  assignments: readonly ShiftAssignment[];
  confirmations: readonly PlanConfirmation[];
  plans: readonly DriverPlan[];
  /** 取り込み原本の抽出結果。無ければ照合しない */
  sourceExtracts?: readonly SourceExtract[];
  /** 解消期限の設定。省略時は既定値 */
  settings?: ReadinessSettings;
};

export function collectUnresolved(input: ReadinessInput): UnresolvedItem[] {
  const requirementMap = new Map(input.requirements.map((r) => [dayKey(r.date, r.courseId, r.cycleNo), r]));
  const baselineMap = new Map(input.baselines.map((b) => [`${frameKey(b.courseId, b.cycleNo)}|${b.weekday}`, b]));
  const baselineFrames = new Set(input.baselines.map((b) => frameKey(b.courseId, b.cycleNo)));
  const confirmationMap = new Map(input.confirmations.map((c) => [driverDayKey(c.driverId, c.date), c]));

  const dates = new Set(input.dates);
  const assignedByDay = new Map<string, ShiftAssignment[]>();
  for (const a of input.assignments) {
    if (!dates.has(a.date)) continue;
    const key = dayKey(a.date, a.courseId, a.cycleNo);
    const list = assignedByDay.get(key);
    if (list) list.push(a);
    else assignedByDay.set(key, [a]);
  }

  const settings = input.settings ?? DEFAULT_READINESS_SETTINGS;
  const items: UnresolvedItem[] = [];
  // 本人の確認を見るときに使う。休みの枠にしか予定が無い人へ「未確認」を出さないため
  const stateByDay = new Map<string, StaffingState>();
  const add = (item: Omit<UnresolvedItem, "dueDate" | "severity">) => {
    const offset = dueDaysFor(item.kind, settings);
    items.push({
      ...item,
      dueDate: offset == null || !item.date ? null : shiftDate(item.date, -offset),
      severity: HIGH.includes(item.kind) ? "high" : "medium",
    });
  };

  // 1) 枠の基準そのものが無い。日付ごとに出すと溢れるので枠単位で1件
  for (const frame of input.frames) {
    if (!baselineFrames.has(frameKey(frame.courseId, frame.cycleNo))) {
      add({ kind: "baseline_missing", date: null, courseId: frame.courseId, cycleNo: frame.cycleNo, driverId: null, detail: "必要人数の基準が未設定" });
    }
  }

  // 2) 日×枠の人数と配車
  for (const date of input.dates) {
    for (const frame of input.frames) {
      const staffing = resolveStaffing(date, frame.courseId, frame.cycleNo, requirementMap, baselineMap);
      stateByDay.set(dayKey(date, frame.courseId, frame.cycleNo), staffing.state);
      const assigned = assignedByDay.get(dayKey(date, frame.courseId, frame.cycleNo)) ?? [];
      const assignedDrivers = assigned.filter((a) => a.driverId);
      const base = { date, courseId: frame.courseId, cycleNo: frame.cycleNo, driverId: null };

      if (staffing.state === "closed") {
        if (assignedDrivers.length > 0) {
          add({ ...base, kind: "assigned_on_closed", detail: `休みの日に${assignedDrivers.length}人配置` });
        }
        continue;
      }
      if (staffing.state === "undecided") {
        // 基準ごと無い枠は 1) で出しているので、ここでは日付の「未確定」だけ
        if (staffing.from !== "none") {
          add({ ...base, kind: "undecided", detail: "必要人数が未確定" });
        }
      } else if (staffing.requiredCount != null && assignedDrivers.length < staffing.requiredCount) {
        add({ ...base, kind: "shortage", detail: `${staffing.requiredCount}人必要・${assignedDrivers.length}人配置` });
      }

      // 配車は人が決まっている枠だけ見る（休み・未確定の枠に車の話を混ぜない）。
      // 1人1件にすると大所帯の会社で一覧が埋まるので、枠ごとにまとめる
      if (staffing.state === "working") {
        const missing = assignedDrivers.filter((a) => !a.vehicleId && !a.usesExternalVehicle);
        if (missing.length > 0) {
          add({
            ...base,
            kind: "no_vehicle",
            driverId: missing.length === 1 ? missing[0].driverId : null,
            detail: missing.length === 1 ? "車両が未割当" : `${missing.length}人の車両が未割当`,
          });
        }
      }
    }
  }

  // 3) 本人の確認。予定がある人だけを見る。
  //    対応不可・要再確認は誰かが分からないと動けないので1人1件。
  //    未確認は運用開始直後に全員ぶん出てしまい、重い項目を押し流すので日ごとにまとめる。
  const unconfirmedByDate = new Map<string, number>();
  const driverDays = new Map<string, ShiftAssignment[]>();
  for (const a of input.assignments) {
    if (!a.driverId || !dates.has(a.date)) continue;
    const key = driverDayKey(a.driverId, a.date);
    const list = driverDays.get(key);
    if (list) list.push(a);
    else driverDays.set(key, [a]);
  }
  for (const plan of input.plans) {
    if (!dates.has(plan.date)) continue;
    // その日の予定が「動かない枠」だけなら、本人へ確認を求める予定が実質無い
    const assignments = driverDays.get(driverDayKey(plan.driverId, plan.date)) ?? [];
    const onlyClosed = assignments.length > 0
      && assignments.every((a) => stateByDay.get(dayKey(a.date, a.courseId, a.cycleNo)) === "closed");
    if (onlyClosed) continue;

    const confirmation = confirmationMap.get(driverDayKey(plan.driverId, plan.date));
    const base = { date: plan.date, courseId: null, cycleNo: null, driverId: plan.driverId };
    if (!confirmation) {
      unconfirmedByDate.set(plan.date, (unconfirmedByDate.get(plan.date) ?? 0) + 1);
    } else if (confirmation.response === "unavailable") {
      add({ ...base, kind: "unavailable", detail: "本人が対応不可" });
    } else if (confirmation.planVersion !== plan.planVersion) {
      add({ ...base, kind: "stale_confirmation", detail: "確認後に予定が変わった" });
    }
  }
  for (const [date, count] of unconfirmedByDate) {
    add({ kind: "unconfirmed", date, courseId: null, cycleNo: null, driverId: null, detail: `${count}人未確認` });
  }

  // 4) 原本との照合。取り込み時の抽出結果と今の配置がずれていないか
  for (const extract of input.sourceExtracts ?? []) {
    if (!dates.has(extract.date)) continue;
    const assigned = assignedByDay.get(dayKey(extract.date, extract.courseId, extract.cycleNo)) ?? [];
    const now = new Set(assigned.map((a) => a.driverId).filter((id): id is string => !!id));
    const source = new Set(extract.driverIds);
    const missing = [...source].filter((id) => !now.has(id));
    const extra = [...now].filter((id) => !source.has(id));
    if (missing.length === 0 && extra.length === 0) continue;
    const parts = [
      missing.length ? `原本にあって未配置 ${missing.length}人` : "",
      extra.length ? `原本に無い配置 ${extra.length}人` : "",
    ].filter(Boolean);
    add({
      kind: "source_mismatch",
      date: extract.date,
      courseId: extract.courseId,
      cycleNo: extract.cycleNo,
      driverId: missing[0] ?? extra[0] ?? null,
      detail: parts.join("・"),
    });
  }

  return items.sort((a, b) => {
    if (a.date !== b.date) return (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31");
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  });
}

/** 期限を過ぎているか（当日を含めて過ぎていない扱い） */
export function isOverdue(item: UnresolvedItem, today: string): boolean {
  return item.dueDate != null && item.dueDate < today;
}
