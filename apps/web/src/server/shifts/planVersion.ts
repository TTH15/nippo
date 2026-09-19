// ============================================================
// 「その人のその日の予定」の版。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1「本人が予定を確認する」
//
// 本人の確認は通知の既読とは別の事実で、**何に対して確認したか**を伴わないと意味がない。
// 集合時刻が動いたのに前の版の確認が残っていると、確認済みのまま現場がずれる。
// そこで重要項目だけを並べて短い版文字列にし、確認と一緒に保存する。
//
// 版に入れないもの:
//   - 車両（配車は運用中に入れ替わる。入れると再確認が頻発して確認が形骸化する）
//   - 表示名・並び順など、集合に関係しない情報
// 車両の未割当は未解決一覧の別項目（no_vehicle）で見る。
// ============================================================
import { createHash } from "node:crypto";

/** 版に効く項目。時刻はコース／便の既定を解決した後の実効値を渡す */
export type PlanAssignment = {
  courseId: string;
  cycleNo: number;
  meetingPlace: string | null;
  meetingTime: string | null;
  arrivalTime: string | null;
  endTime: string | null;
};

/** 予定が1件も無い日の版。「予定なしを確認した」も記録できるようにする */
export const EMPTY_PLAN_VERSION = "none";

const normalize = (value: string | null): string => (value ?? "").trim();

/**
 * その人のその日の予定の版を作る。並び順や重複で版が変わらないよう、
 * 正規化してから並べ替えてハッシュする。
 */
export function planVersionOf(date: string, assignments: readonly PlanAssignment[]): string {
  if (assignments.length === 0) return EMPTY_PLAN_VERSION;
  const lines = assignments
    .map((a) => [
      a.courseId,
      String(a.cycleNo),
      normalize(a.meetingPlace),
      normalize(a.meetingTime),
      normalize(a.arrivalTime),
      normalize(a.endTime),
    ].join("\t"))
    .sort();
  const unique = [...new Set(lines)];
  return createHash("sha256").update([date, ...unique].join("\n")).digest("hex").slice(0, 16);
}

/** shifts の値が無ければ便、便も無ければコースの既定を使う（migration 106 / 136 の約束） */
export function effectiveTime(
  shiftValue: string | null | undefined,
  cycleValue: string | null | undefined,
  courseValue: string | null | undefined,
): string | null {
  return shiftValue ?? cycleValue ?? courseValue ?? null;
}
