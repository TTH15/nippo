import { CheckboxField } from "@/lib/components/CheckboxField";
import { RecordListCard } from "./RecordListCard";
import {
  displayValue,
  type MemberOption,
  type RecordField,
  type RecordEntry,
  type RecordForm,
} from "./model";

type Props = {
  form: RecordForm;
  sample?: RecordEntry;
  onFieldChange: (id: string, patch: Partial<RecordField>) => void;
};

function exampleValue(
  field: RecordField,
  sample: RecordEntry | undefined,
  members: MemberOption[],
): string {
  const savedField = sample?.schema.fields.find(
    (f) => f.id === field.id && f.type === field.type,
  );
  if (savedField && sample?.answers[field.id] !== undefined)
    return displayValue(savedField, sample.answers[field.id], members);
  if (field.type === "number") return `1,000${field.unit ?? ""}`;
  if (field.type === "date") return "2026-08-30";
  if (field.type === "time") return "09:00";
  if (field.type === "bool") return "はい";
  if (field.type === "member") return members[0]?.label ?? "選択したメンバー";
  if (field.type === "select" || field.type === "multiselect")
    return field.options?.[0]?.label || "その他：回答例";
  return `${field.label || "項目"}の回答例`;
}

import { useFormUI } from "./context";

export function ListDisplaySettings({ form, sample, onFieldChange }: Props) {
  const { members } = useFormUI();
  const titleField = form.fields.find((f) => f.id === form.titleField);
  const items = form.fields.filter((f) => f.inList && f.id !== form.titleField);
  const status =
    form.statuses.find((s) => s.id === sample?.status) ?? form.statuses[0];
  return (
    <section className="space-y-4" aria-labelledby="list-display-heading">
      <div>
        <h3 id="list-display-heading" className="text-sm font-semibold">
          記録の一覧に表示する項目
        </h3>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          件名の下に表示する回答を選びます。選ばない項目も、記録を開くと確認できます。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {form.fields
          .filter((f) => f.id !== form.titleField)
          .map((field) => (
            <CheckboxField
              key={field.id}
              label={field.label || "名称未設定"}
              checked={!!field.inList}
              variant="row"
              onCheckedChange={(inList) => onFieldChange(field.id, { inList })}
            />
          ))}
      </div>
      <div className="rounded-xl bg-slate-50 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-600">一覧での見え方</span>
          <span className="text-slate-400">回答例 · 設定に合わせて更新</span>
        </div>
        <div
          role="region"
          aria-label="記録一覧の表示例"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <RecordListCard
            title={
              titleField
                ? exampleValue(titleField, sample, members)
                : "件名を選択してください"
            }
            items={items.map((field) => ({
              id: field.id,
              label: field.label,
              value: exampleValue(field, sample, members),
            }))}
            status={status}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        閲覧できる人は「公開・権限」で設定します。
      </p>
    </section>
  );
}
