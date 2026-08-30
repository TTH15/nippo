import {
  TYPE_LABELS,
  validateDefinition,
  validateAnswers,
  type RecordForm,
  type RecordField,
  type AnswerMap,
  type FormRole,
  type MemberOption,
} from "@/lib/recordForms/model";
export class RecordError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const uuid = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new RecordError("IDが不正です");
  return value;
};
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RecordError("入力形式が不正です");
  return value as Record<string, unknown>;
};
export function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new RecordError("文字列の長さ・内容を確認してください");
  return value.trim();
}
export function integer(value: unknown, min = 1) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new RecordError("版番号が不正です");
  return value;
}
const bool = (v: unknown) => {
  if (typeof v !== "boolean") throw new RecordError("設定値が不正です");
  return v;
};
const key = (v: unknown) => {
  const k = text(v, 80, true);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(k) ||
    ["__proto__", "constructor", "prototype"].includes(k)
  )
    throw new RecordError("項目IDが不正です");
  return k;
};
export function parseDefinition(value: unknown, roles: FormRole[]): RecordForm {
  const v = object(value);
  if (!Array.isArray(v.fields) || v.fields.length > 40)
    throw new RecordError("項目は40個までです");
  const fields: RecordField[] = v.fields.map((raw) => {
    const f = object(raw);
    if (typeof f.type !== "string" || !Object.hasOwn(TYPE_LABELS, f.type))
      throw new RecordError("入力形式が不正です");
    const field: RecordField = {
      id: key(f.id),
      label: text(f.label, 100, true),
      type: f.type as RecordField["type"],
      required: bool(f.required),
    };
    if (f.placeholder !== undefined)
      field.placeholder = text(f.placeholder, 500);
    if (f.inList !== undefined) field.inList = bool(f.inList);
    if (f.typeSelection !== undefined) {
      if (f.typeSelection !== "auto" && f.typeSelection !== "manual")
        throw new RecordError("入力形式設定が不正です");
      field.typeSelection = f.typeSelection;
    }
    if (f.unit !== undefined) field.unit = text(f.unit, 20);
    if (f.maxLen !== undefined) {
      field.maxLen = integer(f.maxLen);
      if (field.maxLen > 10000)
        throw new RecordError("文字数制限は10000文字以下にしてください");
    }
    for (const n of ["min", "max"] as const)
      if (f[n] !== undefined) {
        if (typeof f[n] !== "number" || !Number.isFinite(f[n]))
          throw new RecordError("数値範囲が不正です");
        field[n] = f[n];
      }
    if (f.allowOther !== undefined) field.allowOther = bool(f.allowOther);
    if (f.options !== undefined) {
      if (!Array.isArray(f.options) || f.options.length > 100)
        throw new RecordError("選択肢は100個までです");
      field.options = f.options.map((o) => {
        const option = object(o);
        return {
          value: key(option.value),
          label: text(option.label, 100, true),
        };
      });
      if (
        new Set(field.options.map((o) => o.value)).size !== field.options.length
      )
        throw new RecordError("選択肢IDが重複しています");
    }
    return field;
  });
  if (new Set(fields.map((f) => f.id)).size !== fields.length)
    throw new RecordError("項目IDが重複しています");
  const a = object(v.access);
  const access: RecordForm["access"] = {};
  for (const [id, level] of Object.entries(a)) {
    if (
      !roles.some((r) => r.id === id) ||
      !["none", "view", "edit"].includes(String(level))
    )
      throw new RecordError("この組織のロールを選択してください");
    access[id] = level as "none" | "view" | "edit";
  }
  for (const role of roles) if (role.manager) access[role.id] = "edit";
  const d = object(v.driver);
  if (!Array.isArray(v.statuses) || v.statuses.length > 3)
    throw new RecordError("対応状況が不正です");
  const form: RecordForm = {
    id: uuid(v.id),
    version: integer(v.version),
    name: text(v.name, 80, true),
    category: text(v.category, 40),
    fields,
    titleField: key(v.titleField),
    dateField: v.dateField ? key(v.dateField) : "",
    subjectField: v.subjectField ? key(v.subjectField) : "",
    access,
    driver: {
      submit: bool(d.submit),
      readOwn: bool(d.readOwn),
      editOwn: bool(d.editOwn),
      readSubject: bool(d.readSubject),
    },
    statuses: v.statuses.map((s) => {
      const t = object(s);
      return {
        id: text(t.id, 20),
        label: text(t.label, 20),
        terminal: bool(t.terminal),
      };
    }),
  };
  const error = validateDefinition(form);
  if (error) throw new RecordError(error);
  return form;
}
export function parseAnswers(
  form: RecordForm,
  value: unknown,
  members: MemberOption[],
): AnswerMap {
  const raw = object(value),
    answers: AnswerMap = {};
  if (Object.keys(raw).some((id) => !form.fields.some((f) => f.id === id)))
    throw new RecordError("定義にない項目が含まれています");
  for (const f of form.fields) {
    const v = raw[f.id];
    if (v === undefined) continue;
    if (v === "") {
      answers[f.id] = "";
      continue;
    }
    if (f.type === "number") {
      if (
        (typeof v !== "number" && typeof v !== "string") ||
        !String(v).trim() ||
        !Number.isFinite(Number(v)) ||
        Math.abs(Number(v)) > Number.MAX_SAFE_INTEGER
      )
        throw new RecordError(`「${f.label}」の数値が不正です`);
      answers[f.id] = Number(v);
    } else if (f.type === "bool") answers[f.id] = bool(v);
    else if (f.type === "select" || f.type === "multiselect") {
      if (JSON.stringify(v).length > 15000)
        throw new RecordError("回答が長すぎます");
      answers[f.id] = v as AnswerMap[string];
    } else {
      const t = text(v, f.maxLen ?? (f.type === "long_text" ? 10000 : 500));
      if (
        f.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(t) ||
          Number.isNaN(Date.parse(t)) ||
          new Date(t).toISOString().slice(0, 10) !== t ||
          t < "1900-01-01" ||
          t > "2200-12-31")
      )
        throw new RecordError(`「${f.label}」の日付が不正です`);
      if (f.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
        throw new RecordError(`「${f.label}」の時刻が不正です`);
      answers[f.id] = t;
    }
  }
  const error = validateAnswers(form, answers, members);
  if (error) throw new RecordError(error);
  return answers;
}
