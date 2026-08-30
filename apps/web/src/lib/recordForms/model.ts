import type { ReportField } from "@repo/core/types";
import {
  isOtherChoiceAnswer,
  validateChoiceAnswer,
  type OtherChoiceAnswer,
} from "@/lib/formBuilder/choiceAnswers";
import { FIELD_TYPE_LABELS } from "@/lib/formBuilder/fieldTypes";

export const TYPE_LABELS = FIELD_TYPE_LABELS;
/** 対応状況の意味は共通。フォームごとに有効・無効だけを切り替える。 */
export const RESPONSE_STATUSES = [
  { id: "open", label: "未対応", terminal: false },
  { id: "progress", label: "対応中", terminal: false },
  { id: "resolved", label: "解決済み", terminal: true },
] as const;
export const responseStatuses = () =>
  RESPONSE_STATUSES.map((status) => ({ ...status }));
export type RecordField = Omit<ReportField, "type" | "role"> & {
  type: keyof typeof TYPE_LABELS;
  inList?: boolean;
  unit?: string;
  typeSelection?: "auto" | "manual";
  allowOther?: boolean;
};
export type Access = "none" | "view" | "edit";
export type RecordForm = {
  id: string;
  name: string;
  category: string;
  version: number;
  fields: RecordField[];
  titleField: string;
  dateField: string;
  subjectField: string;
  statuses: { id: string; label: string; terminal: boolean }[];
  access: Record<string, Access>;
  driver: {
    submit: boolean;
    readOwn: boolean;
    editOwn: boolean;
    readSubject: boolean;
  };
};
export type AnswerMap = Record<
  string,
  string | number | boolean | string[] | OtherChoiceAnswer
>;
export type RecordEntry = {
  id: string;
  formId: string;
  schema: RecordForm;
  answers: AnswerMap;
  status: string;
  author: string;
  reporter: string;
  createdAt: string;
  version?: number;
  memberNames?: Record<string, string>;
  history: {
    id?: string;
    at: string;
    by: string;
    text: string;
    internal: boolean;
  }[];
};
export function displayValue(
  field: RecordField,
  value: AnswerMap[string] | undefined,
  members: MemberOption[] = [],
): string {
  if (
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return "—";
  const one = (v: string) =>
    field.type === "member"
      ? (members.find((m) => m.value === v)?.label ?? v)
      : (field.options?.find((o) => o.value === v)?.label ?? v);
  if (isOtherChoiceAnswer(value))
    return [...value.selected.map(one), `その他：${value.other.trim()}`].join(
      "、",
    );
  if (Array.isArray(value)) return value.map(one).join("、");
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (field.type === "number")
    return `${Number(value).toLocaleString("ja-JP")}${field.unit ?? ""}`;
  return one(String(value));
}
export function recordTitle(record: RecordEntry) {
  const field = record.schema.fields.find(
    (f) => f.id === record.schema.titleField,
  );
  return field
    ? displayValue(
        field,
        record.answers[field.id],
        Object.entries(record.memberNames ?? {}).map(([value, label]) => ({
          value,
          label,
        })),
      )
    : record.schema.name;
}
export function validateDefinition(form: RecordForm): string | null {
  if (!form.name.trim()) return "フォーム名を入力してください";
  if (!form.fields.length) return "項目を1つ以上追加してください";
  if (form.fields.length > 40) return "項目は40個までにしてください";
  if (!form.fields.some((f) => f.id === form.titleField))
    return "件名に使う項目を選択してください";
  if (
    form.dateField &&
    !form.fields.some((f) => f.id === form.dateField && f.type === "date")
  )
    return "日付で絞り込む項目を選び直してください";
  if (
    form.subjectField &&
    !form.fields.some((f) => f.id === form.subjectField && f.type === "member")
  )
    return "対象者に使う項目を選び直してください";
  for (const field of form.fields) {
    if (!field.label.trim()) return "項目名を入力してください";
    if (
      ["select", "multiselect"].includes(field.type) &&
      ((!field.options?.length && !field.allowOther) ||
        field.options?.some((o) => !o.label.trim()))
    )
      return `「${field.label}」の選択肢を入力してください`;
    if (
      field.type === "number" &&
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    )
      return `「${field.label}」の最小値・最大値を確認してください`;
  }
  if (
    form.statuses.length &&
    (form.statuses.length !== RESPONSE_STATUSES.length ||
      form.statuses.some((s, i) => {
        const standard = RESPONSE_STATUSES[i];
        return (
          !standard ||
          s.id !== standard.id ||
          s.label !== standard.label ||
          s.terminal !== standard.terminal
        );
      }))
  )
    return "対応状況は「未対応・対応中・解決済み」を使用してください";
  if (form.driver.editOwn && !form.driver.readOwn)
    return "本人の修正には、自分の提出記録の閲覧が必要です";
  if (
    form.driver.readSubject &&
    !form.fields.some((f) => f.id === form.subjectField && f.type === "member")
  )
    return "対象者本人に見せるには、対象者に使うメンバー項目を選んでください";
  return null;
}
export function validateAnswers(
  form: RecordForm,
  answers: AnswerMap,
  members?: MemberOption[],
): string | null {
  for (const f of form.fields) {
    const v = answers[f.id];
    if (f.type === "select" || f.type === "multiselect") {
      const error = validateChoiceAnswer({ ...f, type: f.type }, v);
      if (error) return error;
      continue;
    }
    const empty =
      v === undefined ||
      v === "" ||
      (typeof v === "string" && !v.trim()) ||
      (Array.isArray(v) && !v.length);
    if (empty) {
      if (f.required) return `「${f.label}」を入力してください`;
      continue;
    }
    if (
      f.type === "number" &&
      (!Number.isFinite(Number(v)) ||
        (f.min !== undefined && Number(v) < f.min) ||
        (f.max !== undefined && Number(v) > f.max))
    )
      return `「${f.label}」の数値を確認してください`;
    if (f.type === "member" && members && !members.some((m) => m.value === v))
      return `「${f.label}」のメンバーを選択してください`;
  }
  return null;
}
const noDriver = {
  submit: false,
  readOwn: false,
  editOwn: false,
  readSubject: false,
};
export function makeTemplate(
  template: "case" | "payment" | "memo",
  id: string,
): RecordForm {
  const base: RecordForm = {
    id,
    name: "引き継ぎメモ",
    category: "社内共有",
    version: 1,
    fields: [
      {
        id: "title",
        type: "short_text",
        label: "件名",
        required: true,
        inList: true,
      },
      {
        id: "date",
        type: "date",
        label: "記録日",
        required: true,
        inList: true,
      },
      { id: "body", type: "long_text", label: "内容", required: true },
    ],
    titleField: "title",
    dateField: "date",
    subjectField: "",
    statuses: [],
    access: {},
    driver: { ...noDriver },
  };
  if (template === "memo") return base;
  if (template === "payment")
    return {
      ...base,
      name: "日払い記録",
      category: "支払管理",
      access: {},
      fields: [
        { id: "title", type: "short_text", label: "件名", required: true },
        {
          id: "recipient",
          type: "member",
          label: "支払先",
          required: true,
          inList: true,
        },
        {
          id: "date",
          type: "date",
          label: "支払日",
          required: true,
          inList: true,
        },
        { id: "work_date", type: "date", label: "稼働日", required: true },
        {
          id: "amount",
          type: "number",
          label: "支払金額",
          required: true,
          min: 1,
          max: 999999999,
          unit: "円",
          inList: true,
        },
        {
          id: "method",
          type: "select",
          label: "支払方法",
          required: true,
          inList: true,
          allowOther: true,
          options: [
            { value: "bank", label: "銀行振込" },
            { value: "cash", label: "現金" },
          ],
        },
        { id: "body", type: "long_text", label: "備考", required: false },
      ],
      subjectField: "recipient",
    };
  return {
    ...base,
    name: "案件報告",
    category: "配送品質",
    access: {},
    driver: { submit: true, readOwn: true, editOwn: false, readSubject: false },
    subjectField: "subject",
    statuses: responseStatuses(),
    fields: [
      { id: "title", type: "short_text", label: "件名", required: true },
      {
        id: "date",
        type: "date",
        label: "発生日",
        required: true,
        inList: true,
      },
      {
        id: "subject",
        type: "member",
        label: "対象ドライバー",
        required: false,
        inList: true,
      },
      {
        id: "category",
        type: "select",
        label: "案件内容",
        required: true,
        inList: true,
        allowOther: true,
        options: [
          { value: "misdelivery", label: "誤配" },
          { value: "dropoff", label: "無断置き配" },
          { value: "late", label: "遅配" },
        ],
      },
      { id: "place", type: "short_text", label: "場所", required: false },
      {
        id: "body",
        type: "long_text",
        label: "経緯・報告内容",
        required: true,
      },
      {
        id: "prevention",
        type: "long_text",
        label: "再発防止策",
        required: false,
      },
    ],
  };
}

export type MemberOption = { value: string; label: string };
export type FormRole = { id: string; label: string; manager: boolean };
export type FormGrant = {
  create: boolean;
  readAll: boolean;
  editAll: boolean;
  readOwn: boolean;
  editOwn: boolean;
  readSubject: boolean;
};
