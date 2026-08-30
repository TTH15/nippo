import {
  inferFieldType,
  type FormFieldType,
} from "@/lib/formBuilder/fieldTypes";
import type { RecordField } from "./model";

export function applyFieldType(
  field: RecordField,
  type: FormFieldType,
  typeSelection: "auto" | "manual",
): RecordField {
  return {
    ...field,
    type,
    typeSelection,
    // 形式を行き来しても、設定済みの選択肢は失わない。
    ...(["select", "multiselect"].includes(type) && !field.options?.length
      ? { options: [{ value: crypto.randomUUID(), label: "選択肢1" }] }
      : {}),
  };
}

export function inferAutomaticField(field: RecordField): RecordField {
  // 未指定は既存の項目。自動選択を明示した項目だけを変更する。
  if (field.typeSelection !== "auto") return field;
  const type = inferFieldType(field.label) ?? "short_text";
  return type === field.type ? field : applyFieldType(field, type, "auto");
}
