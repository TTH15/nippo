// ============================================================
// 必要人数の保存入力の検証（純粋関数）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1「必要人数を配置とは別に管理」
//
// 「未確定」を正常扱いしないための表なので、人数の省略と 0 を同じにしない。
// working は人数必須、closed / undecided は人数を持たない。
// ============================================================
import type { StaffingState } from "./readiness";

export const MAX_STAFFING_COUNT = 50;

const STATES: StaffingState[] = ["working", "closed", "undecided"];

/** 日付の指定。state=null はその日の指定を消す（曜日の基準へ戻す） */
export type RequirementInput = {
  date: string;
  courseId: string;
  cycleNo: number;
  state: StaffingState | null;
  requiredCount: number | null;
  note: string;
};

/** 曜日の基準。state=null はその曜日の基準を消す（未入力へ戻す） */
export type BaselineInput = {
  courseId: string;
  cycleNo: number;
  weekday: number;
  state: "working" | "closed" | null;
  requiredCount: number | null;
};

export type StaffingParseResult =
  | { ok: true; requirements: RequirementInput[]; baselines: BaselineInput[] }
  | { ok: false; error: string };

const isDateOnly = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

const isCycleNo = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 99;

/** working のときだけ人数を持つ。0 は「動くが人は要らない」で有効 */
function countFor(state: string, raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (state !== "working") return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_STAFFING_COUNT) return { ok: false };
  return { ok: true, value: raw };
}

export function parseStaffingInput(
  body: unknown,
  ctx: { allowedFrames: ReadonlySet<string> },
): StaffingParseResult {
  if (!body || typeof body !== "object") return { ok: false, error: "保存する内容を確認してください" };
  const { requirements: rawRequirements, baselines: rawBaselines } = body as Record<string, unknown>;
  if (rawRequirements !== undefined && !Array.isArray(rawRequirements)) return { ok: false, error: "保存する内容を確認してください" };
  if (rawBaselines !== undefined && !Array.isArray(rawBaselines)) return { ok: false, error: "保存する内容を確認してください" };
  const requirementRows = (rawRequirements ?? []) as unknown[];
  const baselineRows = (rawBaselines ?? []) as unknown[];
  if (requirementRows.length + baselineRows.length === 0) return { ok: false, error: "保存する内容がありません" };
  if (requirementRows.length > 500 || baselineRows.length > 200) return { ok: false, error: "一度に保存できる件数を超えています" };

  const requirements: RequirementInput[] = [];
  const seenRequirements = new Set<string>();
  for (const row of requirementRows) {
    if (!row || typeof row !== "object") return { ok: false, error: "必要人数の指定が不正です" };
    const { date, courseId, cycleNo, state, requiredCount, note } = row as Record<string, unknown>;
    if (!isDateOnly(date)) return { ok: false, error: "日付が不正です" };
    if (typeof courseId !== "string" || !isCycleNo(cycleNo)) return { ok: false, error: "コースまたは便が不正です" };
    if (!ctx.allowedFrames.has(`${courseId}|${cycleNo}`)) return { ok: false, error: "そのコース・便は選べません" };
    if (state !== null && (typeof state !== "string" || !STATES.includes(state as StaffingState))) {
      return { ok: false, error: "必要人数の状態が不正です" };
    }
    const key = `${date}|${courseId}|${cycleNo}`;
    if (seenRequirements.has(key)) return { ok: false, error: "同じ日・コース・便が重複しています" };
    seenRequirements.add(key);
    const count = countFor(state ?? "", requiredCount);
    if (!count.ok) return { ok: false, error: `必要人数は0〜${MAX_STAFFING_COUNT}人で指定してください` };
    const text = typeof note === "string" ? note.trim() : "";
    if (text.length > 200) return { ok: false, error: "メモは200文字までです" };
    requirements.push({ date, courseId, cycleNo, state: (state as StaffingState | null) ?? null, requiredCount: count.value, note: text });
  }

  const baselines: BaselineInput[] = [];
  const seenBaselines = new Set<string>();
  for (const row of baselineRows) {
    if (!row || typeof row !== "object") return { ok: false, error: "曜日の基準が不正です" };
    const { courseId, cycleNo, weekday, state, requiredCount } = row as Record<string, unknown>;
    if (typeof courseId !== "string" || !isCycleNo(cycleNo)) return { ok: false, error: "コースまたは便が不正です" };
    if (!ctx.allowedFrames.has(`${courseId}|${cycleNo}`)) return { ok: false, error: "そのコース・便は選べません" };
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, error: "曜日が不正です" };
    }
    // 曜日の基準に「未確定」は置かない（未確定はその日の指定で表す）
    if (state !== null && state !== "working" && state !== "closed") return { ok: false, error: "曜日の基準の状態が不正です" };
    const key = `${courseId}|${cycleNo}|${weekday}`;
    if (seenBaselines.has(key)) return { ok: false, error: "同じコース・便・曜日が重複しています" };
    seenBaselines.add(key);
    const count = countFor(state ?? "", requiredCount);
    if (!count.ok) return { ok: false, error: `必要人数は0〜${MAX_STAFFING_COUNT}人で指定してください` };
    baselines.push({ courseId, cycleNo, weekday, state: (state as "working" | "closed" | null) ?? null, requiredCount: count.value });
  }

  return { ok: true, requirements, baselines };
}
