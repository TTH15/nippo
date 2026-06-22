// ============================================================
// 報告の回答(answers) ⇄ 既存固定カラムのブリッジ。
// 新レポートは answers に値を持つ。旧レポート(answers={})は固定カラムへ fallback。
// 固定ID（f_location/f_odometer/f_description/f_amount）が既存カラムに対応。
// ============================================================

import type { ReportField, FieldRole } from "./fields";

/** answers/固定カラムを持つレポートの最小形（loose）。 */
export type ReportLike = {
  answers?: Record<string, unknown> | null;
  location?: string | null;
  odometer_km?: number | null;
  description?: string | null;
  expense_amount?: number | null;
};

const LEGACY_BY_FIELD_ID: Record<string, (r: ReportLike) => unknown> = {
  f_location: (r) => r.location ?? undefined,
  f_odometer: (r) => (r.odometer_km == null ? undefined : r.odometer_km),
  f_description: (r) => (r.description ? r.description : undefined),
  f_amount: (r) => (r.expense_amount == null ? undefined : r.expense_amount),
};

/** フィールドの回答値（answers 優先・既定IDは固定カラム fallback）。 */
export function getAnswerValue(report: ReportLike, field: ReportField): unknown {
  const a = report.answers;
  if (a && Object.prototype.hasOwnProperty.call(a, field.id) && a[field.id] !== undefined) {
    return a[field.id];
  }
  const legacy = LEGACY_BY_FIELD_ID[field.id];
  return legacy ? legacy(report) : undefined;
}

/** role(odometer/amount) を持つフィールドの値を解決（capability 副作用用）。 */
export function getRoleValue(report: ReportLike, fields: ReportField[], role: FieldRole): number | null {
  const f = fields.find((x) => x.role === role);
  if (!f) return null;
  const v = getAnswerValue(report, f);
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 表示用の文字列整形（承認UI等）。selectはラベル、boolははい/いいえ、複数選択は連結。 */
export function formatAnswer(field: ReportField, value: unknown): string {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "—";
  switch (field.type) {
    case "bool":
      return value === true ? "はい" : "いいえ";
    case "select": {
      const opt = (field.options ?? []).find((o) => o.value === value);
      return opt ? opt.label : String(value);
    }
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      return arr
        .map((v) => (field.options ?? []).find((o) => o.value === v)?.label ?? String(v))
        .join("、");
    }
    case "number":
      return typeof value === "number" ? value.toLocaleString("ja-JP") : String(value);
    default:
      return String(value);
  }
}
