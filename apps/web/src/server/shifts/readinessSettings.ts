// ============================================================
// 未解決一覧の解消期限と先読み日数（会社ごとの設定）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// 既定値は 2026-09-17 まで固定値だったものをそのまま引き継ぐ。
// 設定が無い会社・migration 171 が未適用の環境では、この既定値で動く。
// ============================================================
import type { UnresolvedKind } from "./readiness";

/** 手を打つ相手が同じものをまとめた3つの区分 */
export type DueGroup = "staffing" | "confirmation" | "dispatch";

/** 種類 → 区分。null は「特定の日の話ではない」＝期限を持たない */
export const DUE_GROUP_OF: Record<UnresolvedKind, DueGroup | null> = {
  shortage: "staffing",
  undecided: "staffing",
  assigned_on_closed: "staffing",
  source_mismatch: "staffing",
  unavailable: "confirmation",
  stale_confirmation: "confirmation",
  unconfirmed: "confirmation",
  no_vehicle: "dispatch",
  baseline_missing: null,
};

export type ReadinessSettings = {
  /** 対象日の何日前までに直すか */
  staffingDueDays: number;
  confirmationDueDays: number;
  dispatchDueDays: number;
  /** 何日先まで一覧に出すか */
  horizonDays: number;
};

/** 設定が無いときの値。2026-09-17 までコードに固定していたものと同じ */
export const DEFAULT_READINESS_SETTINGS: ReadinessSettings = {
  staffingDueDays: 3,
  confirmationDueDays: 2,
  dispatchDueDays: 1,
  horizonDays: 14,
};

export const MAX_DUE_DAYS = 30;
export const MAX_HORIZON_DAYS = 60;

/** その種類の期限は対象日の何日前か。期限を持たない種類は null */
export function dueDaysFor(kind: UnresolvedKind, settings: ReadinessSettings): number | null {
  const group = DUE_GROUP_OF[kind];
  if (group === null) return null;
  if (group === "staffing") return settings.staffingDueDays;
  if (group === "confirmation") return settings.confirmationDueDays;
  return settings.dispatchDueDays;
}

export type SettingsParseResult =
  | { ok: true; value: ReadinessSettings }
  | { ok: false; error: string };

const asDays = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/**
 * 保存する設定を検証する。先読みが期限より短いと、期限が来る前に一覧へ出ない日ができるので拒否する。
 */
export function parseReadinessSettings(raw: unknown): SettingsParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "設定の内容を確認してください" };
  const body = raw as Record<string, unknown>;
  const staffingDueDays = asDays(body.staffingDueDays, MAX_DUE_DAYS);
  const confirmationDueDays = asDays(body.confirmationDueDays, MAX_DUE_DAYS);
  const dispatchDueDays = asDays(body.dispatchDueDays, MAX_DUE_DAYS);
  if (staffingDueDays == null || confirmationDueDays == null || dispatchDueDays == null) {
    return { ok: false, error: `期限は0〜${MAX_DUE_DAYS}日前で指定してください` };
  }
  const horizonDays = asDays(body.horizonDays, MAX_HORIZON_DAYS);
  if (horizonDays == null || horizonDays < 1) {
    return { ok: false, error: `先読みは1〜${MAX_HORIZON_DAYS}日で指定してください` };
  }
  const longest = Math.max(staffingDueDays, confirmationDueDays, dispatchDueDays);
  if (horizonDays < longest) {
    return { ok: false, error: `先読みは一番長い期限（${longest}日前）以上にしてください` };
  }
  return { ok: true, value: { staffingDueDays, confirmationDueDays, dispatchDueDays, horizonDays } };
}

/** DB の行を設定へ。読めない値は既定値で埋める（設定のせいで一覧が消えないように） */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): ReadinessSettings {
  if (!row) return DEFAULT_READINESS_SETTINGS;
  const pick = (value: unknown, fallback: number, max: number) => asDays(value, max) ?? fallback;
  const settings: ReadinessSettings = {
    staffingDueDays: pick(row.staffing_due_days, DEFAULT_READINESS_SETTINGS.staffingDueDays, MAX_DUE_DAYS),
    confirmationDueDays: pick(row.confirmation_due_days, DEFAULT_READINESS_SETTINGS.confirmationDueDays, MAX_DUE_DAYS),
    dispatchDueDays: pick(row.dispatch_due_days, DEFAULT_READINESS_SETTINGS.dispatchDueDays, MAX_DUE_DAYS),
    horizonDays: pick(row.horizon_days, DEFAULT_READINESS_SETTINGS.horizonDays, MAX_HORIZON_DAYS),
  };
  // 壊れた組み合わせでも一覧は出す（先読みを期限に合わせて広げる）
  const longest = Math.max(settings.staffingDueDays, settings.confirmationDueDays, settings.dispatchDueDays);
  return { ...settings, horizonDays: Math.max(settings.horizonDays, longest, 1) };
}
