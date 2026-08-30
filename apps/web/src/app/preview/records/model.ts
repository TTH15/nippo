import {
  displayValue as formatValue,
  validateAnswers as checkAnswers,
  type RecordField as DemoField,
  type RecordForm as FormDefinition,
  type RecordEntry as DemoRecord,
  type AnswerMap,
} from "@/lib/recordForms/model";
import { makeTemplate as makeCoreTemplate } from "@/lib/recordForms/model";
export {
  TYPE_LABELS,
  RESPONSE_STATUSES,
  responseStatuses,
  recordTitle,
  validateDefinition,
} from "@/lib/recordForms/model";
export type {
  RecordField as DemoField,
  RecordForm as FormDefinition,
  RecordEntry as DemoRecord,
  AnswerMap,
  Access,
} from "@/lib/recordForms/model";
export function makeTemplate(
  kind: "case" | "payment" | "memo",
  id: string,
): FormDefinition {
  const form = makeCoreTemplate(kind, id);
  form.access =
    kind === "payment"
      ? { admin: "edit", operations: "none", accounting: "edit" }
      : kind === "case"
        ? { admin: "edit", operations: "edit", accounting: "none" }
        : { admin: "edit", operations: "edit", accounting: "view" };
  return form;
}
export type DemoRole = "admin" | "operations" | "accounting" | "driver";
export const ROLE_LABELS: Record<DemoRole, string> = {
  admin: "管理者",
  operations: "運営担当",
  accounting: "経理担当",
  driver: "ドライバー",
};
export const MEMBERS = [
  { value: "sato", label: "佐藤（サンプル）" },
  { value: "sakata", label: "坂田（サンプル）" },
  { value: "staff", label: "運営担当（サンプル）" },
];
export const actorId = (role: DemoRole) =>
  role === "driver" ? "sato" : "staff";
export function canConfigure(role: DemoRole) {
  return role === "admin";
}
export function canCreate(form: FormDefinition, role: DemoRole) {
  return role === "driver" ? form.driver.submit : form.access[role] === "edit";
}
export function canSeeForm(form: FormDefinition, role: DemoRole) {
  return role === "driver"
    ? Object.values(form.driver).some(Boolean)
    : form.access[role] !== "none";
}
export function canReadRecord(
  form: FormDefinition,
  role: DemoRole,
  record: DemoRecord,
) {
  if (role !== "driver") return form.access[role] !== "none";
  return (
    (form.driver.readOwn && record.author === actorId(role)) ||
    (form.driver.readSubject &&
      !!form.subjectField &&
      record.answers[form.subjectField] === actorId(role))
  );
}
export function canEditRecord(
  form: FormDefinition,
  role: DemoRole,
  record: DemoRecord,
) {
  return role === "driver"
    ? form.driver.editOwn &&
        form.driver.readOwn &&
        record.author === actorId(role)
    : form.access[role] === "edit";
}
export const displayValue = (
  field: DemoField,
  value: AnswerMap[string] | undefined,
) => formatValue(field, value, MEMBERS);
export const validateAnswers = (form: FormDefinition, answers: AnswerMap) =>
  checkAnswers(form, answers, MEMBERS);
export function initialDemo(): {
  forms: FormDefinition[];
  records: DemoRecord[];
} {
  const forms = [
    makeTemplate("case", "cases"),
    makeTemplate("payment", "payments"),
    makeTemplate("memo", "memos"),
  ];
  const make = (
    form: FormDefinition,
    id: string,
    author: string,
    answers: AnswerMap,
    status: string,
  ): DemoRecord => ({
    id,
    formId: form.id,
    schema: structuredClone(form),
    answers,
    status,
    author,
    reporter: author,
    createdAt: "2026-08-29T09:00:00+09:00",
    history: [],
  });
  return {
    forms,
    records: [
      {
        ...make(
          forms[0],
          "case-1",
          "sato",
          {
            title: "研修中の置き配で誤配",
            date: "2026-08-29",
            subject: "sato",
            category: "misdelivery",
            place: "集合住宅（サンプル）",
            body: "研修中の置き配で別の部屋に配達。問い合わせを受けて回収し、正しい宛先へ届けた。",
            prevention: "研修中は同行者が部屋番号と伝票をダブルチェックする。",
          },
          "resolved",
        ),
        history: [
          {
            at: "2026-08-29T14:00:00+09:00",
            by: "staff",
            text: "次回の同行研修で確認手順を見直す。",
            internal: true,
          },
        ],
      },
      make(
        forms[0],
        "case-2",
        "sakata",
        {
          title: "指定時間に関する問い合わせ",
          date: "2026-08-28",
          subject: "sakata",
          category: "late",
          body: "訪問時刻と時間指定を確認中。",
        },
        "progress",
      ),
      make(
        forms[1],
        "payment-1",
        "staff",
        {
          title: "佐藤・6月17日稼働分",
          recipient: "sato",
          date: "2026-06-18",
          work_date: "2026-06-17",
          amount: 8500,
          method: "bank",
          body: "振込実施の記録。会計への連携なし。",
        },
        "",
      ),
      make(
        forms[2],
        "memo-1",
        "staff",
        {
          title: "週明けの引き継ぎ",
          date: "2026-08-30",
          body: "予備端末を充電し、運営担当へ引き継ぐ。",
        },
        "",
      ),
    ],
  };
}
