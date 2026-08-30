import { expect, it } from "vitest";
import { applyFieldType, inferAutomaticField } from "./fieldEditing";
import type { DemoField } from "./model";

it("既存項目・手動で選んだ形式は項目名が変わっても上書きしない", () => {
  const existing: DemoField = { id: "test", label: "支払日", type: "long_text", required: false };
  expect(inferAutomaticField(existing)).toBe(existing);
  const manual = { ...existing, typeSelection: "manual" as const };
  expect(inferAutomaticField(manual)).toBe(manual);
  expect(inferAutomaticField({ ...existing, typeSelection: "auto" }).type).toBe("date");
});

it("自動モードで名前の意味が変われば誤った形式を残さず、短文へ戻す", () => {
  expect(inferAutomaticField({ id: "test", label: "自由な質問", type: "date", required: false, typeSelection: "auto" }).type).toBe("short_text");
});

it("形式を行き来しても編集済みの選択肢を保持する", () => {
  const field: DemoField = { id: "test", label: "支払方法", type: "select", required: false, options: [{ value: "bank", label: "振込" }] };
  const text = applyFieldType(field, "long_text", "manual");
  expect(applyFieldType(text, "multiselect", "manual").options).toEqual(field.options);
});
