// ============================================================
// 諸報告フォームビルダーのフィールド定義・バリデーション。
// サーバ（信頼境界）とクライアント（即時UX）で共有する純TS（ランタイム依存なし）。
// 型の正準は @repo/core/types（Web/RN 共有）。ここでは import して再export し、
// 既存の "@/server/reportKinds/fields" 経由の型 import を無改変で維持する。
// ============================================================

import type {
  FieldType,
  FieldRole,
  FieldOption,
  ReportField,
  VehicleMode,
  AnswerAttachment,
} from "@repo/core/types";

export type { FieldType, FieldRole, FieldOption, ReportField, VehicleMode, AnswerAttachment };

export const FIELD_TYPES: FieldType[] = [
  "short_text",
  "long_text",
  "number",
  "select",
  "multiselect",
  "date",
  "time",
  "bool",
  "file",
];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  short_text: "短文",
  long_text: "長文",
  number: "数値",
  select: "選択肢（単一）",
  multiselect: "複数選択",
  date: "日付",
  time: "時刻",
  bool: "はい / いいえ",
  file: "ファイル添付",
};

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
export const DEFAULT_ACCEPT_MIME = ["application/pdf", "image/jpeg", "image/png"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function normOptions(raw: unknown): FieldOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FieldOption[] = [];
  raw.forEach((o) => {
    if (isObj(o) && typeof o.value === "string" && o.value) {
      out.push({ value: o.value, label: typeof o.label === "string" && o.label ? o.label : o.value });
    }
  });
  return out.length ? out : undefined;
}

/** jsonb から ReportField[] を安全に正規化（不正は捨てる）。 */
export function normalizeFields(raw: unknown): ReportField[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportField[] = [];
  raw.forEach((f, i) => {
    if (!isObj(f)) return;
    const type = FIELD_TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : null;
    if (!type) return;
    const id = typeof f.id === "string" && f.id ? f.id : `f_${i}`;
    const field: ReportField = {
      id,
      type,
      label: typeof f.label === "string" ? f.label : "",
      required: f.required === true,
    };
    if (typeof f.placeholder === "string") field.placeholder = f.placeholder;
    if (typeof f.maxLen === "number") field.maxLen = f.maxLen;
    if (typeof f.min === "number") field.min = f.min;
    if (typeof f.max === "number") field.max = f.max;
    const opts = normOptions(f.options);
    if (opts) field.options = opts;
    if (f.role === "odometer" || f.role === "amount") field.role = f.role;
    else field.role = "none";
    if (typeof f.maxFileBytes === "number") field.maxFileBytes = f.maxFileBytes;
    if (Array.isArray(f.acceptMime)) field.acceptMime = f.acceptMime.filter((m): m is string => typeof m === "string");
    return out.push(field);
  });
  return out;
}

// --- 添付（answers とは別に保持。型は @repo/core/types より） ---
export function normalizeAttachments(raw: unknown): AnswerAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: AnswerAttachment[] = [];
  raw.forEach((a) => {
    if (isObj(a) && typeof a.fieldId === "string" && typeof a.path === "string") {
      out.push({
        fieldId: a.fieldId,
        path: a.path,
        name: typeof a.name === "string" ? a.name : "file",
        mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
        size: typeof a.size === "number" ? a.size : 0,
      });
    }
  });
  return out;
}

// --- ビルダー保存時の整合性チェック ---
export type Capability = "none" | "oil_mileage" | "expense";

export function validateKindFields(
  fields: ReportField[],
  vehicleMode: VehicleMode,
  capability: Capability,
): { ok: true } | { ok: false; message: string } {
  const ids = new Set<string>();
  for (const f of fields) {
    if (!f.label.trim()) return { ok: false, message: "ラベルが未入力のフィールドがあります。" };
    if (ids.has(f.id)) return { ok: false, message: "フィールドIDが重複しています。" };
    ids.add(f.id);
    if ((f.type === "select" || f.type === "multiselect") && (!f.options || f.options.length === 0)) {
      return { ok: false, message: `「${f.label}」には選択肢を1つ以上設定してください。` };
    }
    if (f.role && f.role !== "none" && f.type !== "number") {
      return { ok: false, message: `「${f.label}」: 走行距離/金額の連携は数値フィールドにのみ設定できます。` };
    }
  }
  const roleCount = (r: FieldRole) => fields.filter((f) => f.role === r).length;
  if (roleCount("odometer") > 1) return { ok: false, message: "走行距離（連携）フィールドは1つまでです。" };
  if (roleCount("amount") > 1) return { ok: false, message: "金額（連携）フィールドは1つまでです。" };

  if (capability === "expense") {
    const amt = fields.find((f) => f.role === "amount");
    if (!amt) return { ok: false, message: "「経費連携」には金額（連携）フィールドが必要です。" };
    if (!amt.required) return { ok: false, message: "金額（連携）フィールドは必須にしてください。" };
  }
  if (capability === "oil_mileage") {
    const odo = fields.find((f) => f.role === "odometer");
    if (!odo) return { ok: false, message: "「車両距離更新」には走行距離（連携）フィールドが必要です。" };
    if (!odo.required) return { ok: false, message: "走行距離（連携）フィールドは必須にしてください。" };
    if (vehicleMode !== "required") return { ok: false, message: "「車両距離更新」には車両を必須にしてください。" };
  }
  return { ok: true };
}

// --- 回答バリデーション（作成時／クライアント即時） ---
type AnswerMap = Record<string, unknown>;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** YYYY-MM-DD が実在する日付か（形式 + カレンダー上の妥当性）。 */
function isValidDateStr(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[mo - 1];
}

/** HH:MM が実在する時刻か（00:00〜23:59）。 */
function isValidTimeStr(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

export function validateAnswers(
  fields: ReportField[],
  answers: AnswerMap,
  attachmentsByField: Record<string, number> = {},
): { ok: true } | { ok: false; fieldId: string; message: string } {
  for (const f of fields) {
    const v = answers[f.id];
    if (f.type === "file") {
      const count = attachmentsByField[f.id] ?? 0;
      if (f.required && count === 0) return { ok: false, fieldId: f.id, message: `「${f.label}」のファイルを添付してください。` };
      continue;
    }
    if (isEmpty(v)) {
      if (f.required) return { ok: false, fieldId: f.id, message: `「${f.label}」を入力してください。` };
      continue;
    }
    switch (f.type) {
      case "short_text":
      case "long_text": {
        if (typeof v !== "string") return { ok: false, fieldId: f.id, message: `「${f.label}」が不正です。` };
        if (f.maxLen && v.length > f.maxLen) return { ok: false, fieldId: f.id, message: `「${f.label}」は${f.maxLen}文字以内で入力してください。` };
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) return { ok: false, fieldId: f.id, message: `「${f.label}」は数値で入力してください。` };
        if (f.role === "odometer" && (!Number.isInteger(n) || n < 0))
          return { ok: false, fieldId: f.id, message: `「${f.label}」は0以上の整数で入力してください。` };
        if (f.role === "amount" && (!Number.isInteger(n) || n <= 0))
          return { ok: false, fieldId: f.id, message: `「${f.label}」は1以上の整数で入力してください。` };
        if (typeof f.min === "number" && n < f.min) return { ok: false, fieldId: f.id, message: `「${f.label}」は${f.min}以上で入力してください。` };
        if (typeof f.max === "number" && n > f.max) return { ok: false, fieldId: f.id, message: `「${f.label}」は${f.max}以下で入力してください。` };
        break;
      }
      case "select": {
        if (typeof v !== "string" || !(f.options ?? []).some((o) => o.value === v))
          return { ok: false, fieldId: f.id, message: `「${f.label}」の選択が不正です。` };
        break;
      }
      case "multiselect": {
        const arr = Array.isArray(v) ? v : null;
        if (!arr || !arr.every((x) => (f.options ?? []).some((o) => o.value === x)))
          return { ok: false, fieldId: f.id, message: `「${f.label}」の選択が不正です。` };
        break;
      }
      case "date": {
        if (typeof v !== "string" || !isValidDateStr(v)) return { ok: false, fieldId: f.id, message: `「${f.label}」の日付が不正です。` };
        break;
      }
      case "time": {
        if (typeof v !== "string" || !isValidTimeStr(v)) return { ok: false, fieldId: f.id, message: `「${f.label}」の時刻が不正です。` };
        break;
      }
      case "bool": {
        if (typeof v !== "boolean") return { ok: false, fieldId: f.id, message: `「${f.label}」が不正です。` };
        break;
      }
    }
  }
  return { ok: true };
}
