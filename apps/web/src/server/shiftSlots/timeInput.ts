// ============================================================
// A2 時間モデル — API 入力の時刻正規化（courses / shifts の時間列共通）。
//   設計: docs/roadmap-2026-07.md A2（実効値 = shifts.* ?? courses.*）
// ============================================================

/** "HH:MM"（input type=time の値）を検証して返す。空・不正は null（=未設定）。 */
export function normalizeTimeInput(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
}

/** 集合場所などの自由入力テキスト。空白のみは null（=未設定）。 */
export function normalizePlaceInput(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
