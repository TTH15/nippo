"use client";
import type { FieldDef } from "@repo/core/types";
import { CheckboxField } from "./CheckboxField";

/** 本人の日報と管理側の振り分け設定で、同じ入力欄を描画する。 */
export function ReportFieldInputs({ fields, valueFor, onChange, preview = false }: {
  fields: Pick<FieldDef, "fieldKey" | "label" | "inputType" | "required">[];
  valueFor: (fieldKey: string) => string;
  onChange: (fieldKey: string, value: string) => void;
  preview?: boolean;
}) {
  return <div className="grid grid-cols-2 gap-3">{fields.map(f => {
    const value = valueFor(f.fieldKey);
    if (f.inputType === "BOOL") return <CheckboxField key={f.fieldKey} label={f.required ? `${f.label}（必須）` : f.label} variant="row"
      checked={value === "true"} disabled={preview} onCheckedChange={checked => onChange(f.fieldKey, checked ? "true" : "false")} />;
    const numeric = f.inputType === "INT";
    return <label key={f.fieldKey} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{f.label}{f.required && <span className="ml-0.5 text-red-500">*</span>}</span>
      <input aria-label={f.label} type={numeric ? "number" : f.inputType === "TIME" ? "time" : "text"}
        inputMode={numeric ? "numeric" : undefined} min={numeric ? "0" : undefined} placeholder={numeric ? "0" : ""}
        value={value} readOnly={preview} tabIndex={preview ? -1 : undefined} onChange={e => onChange(f.fieldKey, e.target.value)}
        className={`w-full min-w-0 border-0 bg-transparent py-2 focus:outline-none ${numeric ? "text-3xl font-bold text-brand-900" : "text-lg text-slate-900"}`} />
    </label>;
  })}</div>;
}
