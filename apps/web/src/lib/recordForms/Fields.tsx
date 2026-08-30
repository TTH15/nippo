"use client";
import { ChoiceInput } from "@/lib/components/ChoiceInput";
import { isOtherChoiceAnswer } from "@/lib/formBuilder/choiceAnswers";
import { useId } from "react";
import { format } from "date-fns";
import { DatePicker } from "@/lib/components/DatePicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { type AnswerMap, type RecordField } from "./model";
import { useFormUI } from "./context";
export const control =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50";
export const selectStyle =
  "!h-11 !rounded-lg !border !border-slate-300 focus:!ring-2";
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <CustomSelect
      ariaLabel={label}
      options={options}
      value={value}
      onChange={onChange}
      size="md"
      clearable={false}
      triggerClassName={selectStyle}
      disabled={disabled}
    />
  );
}
export function FieldControl({
  field,
  value,
  onChange,
  hideLabel = false,
  savedMemberLabel,
}: {
  field: RecordField;
  value: AnswerMap[string] | undefined;
  onChange: (value: AnswerMap[string]) => void;
  hideLabel?: boolean;
  savedMemberLabel?: string;
}) {
  const id = useId();
  const { members } = useFormUI();
  const string = value === undefined ? "" : String(value);
  return (
    <div
      className={`min-w-0 ${field.type === "long_text" ? "sm:col-span-2" : ""}`}
    >
      <label
        htmlFor={id}
        className={
          hideLabel
            ? "sr-only"
            : "mb-1.5 block text-xs font-semibold text-slate-600"
        }
      >
        {field.label || "名称未設定"}
        {field.required && <span className="ml-1 text-amber-700">*</span>}
      </label>
      {field.type === "date" ? (
        <DatePicker
          id={id}
          value={string ? new Date(`${string}T00:00:00`) : undefined}
          onChange={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
          displayFormat="yyyy/MM/dd"
          className="h-11 w-full rounded-lg border-slate-300"
        />
      ) : field.type === "select" || field.type === "multiselect" ? (
        <ChoiceInput
          id={id}
          label={field.label || "名称未設定"}
          options={field.options ?? []}
          multiple={field.type === "multiselect"}
          allowOther={field.allowOther}
          required={field.required}
          value={
            typeof value === "string" ||
            Array.isArray(value) ||
            isOtherChoiceAnswer(value)
              ? value
              : undefined
          }
          onChange={onChange}
        />
      ) : field.type === "member" ? (
        <CustomSelect
          id={id}
          size="md"
          triggerClassName={selectStyle}
          clearable={false}
          value={string}
          options={[
            ...(!field.required ? [{ value: "", label: "未指定" }] : []),
            ...members,
            ...(string &&
            savedMemberLabel &&
            !members.some((member) => member.value === string)
              ? [{ value: string, label: savedMemberLabel }]
              : []),
          ]}
          onChange={onChange}
        />
      ) : field.type === "bool" ? (
        <CustomSelect
          id={id}
          size="md"
          triggerClassName={selectStyle}
          clearable={false}
          value={
            value === undefined || value === "" ? "" : value ? "yes" : "no"
          }
          options={[
            { value: "", label: "未指定" },
            { value: "yes", label: "はい" },
            { value: "no", label: "いいえ" },
          ]}
          onChange={(v) => onChange(v === "" ? "" : v === "yes")}
        />
      ) : field.type === "long_text" ? (
        <textarea
          id={id}
          className={control}
          rows={4}
          value={string}
          maxLength={field.maxLen ?? 10000}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            id={id}
            className={control}
            type={
              field.type === "number"
                ? "number"
                : field.type === "time"
                  ? "time"
                  : "text"
            }
            value={string}
            min={field.type === "number" ? field.min : undefined}
            max={field.type === "number" ? field.max : undefined}
            maxLength={field.maxLen ?? 500}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.type === "number" && field.unit && (
            <span className="shrink-0 text-sm text-slate-500">
              {field.unit}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
