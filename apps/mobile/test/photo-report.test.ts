import { expect, it } from "vitest";
import { buildPhotoReportItems } from "../src/reports/photo-report";
import { previewReportCourse, previewReportForm, savePreviewReport } from "../ui-preview/report-fixture";
import { applyImageEntries } from "@repo/core/logic/reportImageEntries";

it("写真方式の日報は既存メーターを再送せず、APIの確定値を保存する", () => {
  const date = "2026-10-03";
  const items = buildPhotoReportItems([previewReportCourse], { "preview-course:1": { "preview-unit": { delivered: "84" } } }, "van");
  expect(items[0]).not.toHaveProperty("meterValue");
  expect(items[0].entries[0].valueNum).toBe(84);
  savePreviewReport({ reportDate: date, items: [{ ...items[0], meterValue: 123456 }] });
  savePreviewReport({ reportDate: date, items });
  expect(previewReportForm(date).shifts[0].existing?.meterValue).toBe(123456);
});
it("同じコースの別便に画像の数字を転記しない", () => {
  const shift = { ...previewReportCourse, cycleNo: 2 };
  const before = { "preview-course:1": { "preview-unit": { delivered: "35" } } };
  const result = applyImageEntries(before, [shift], [{ unitId: "preview-unit", fieldKey: "delivered", value: 84 }]);
  expect(result.values["preview-course:1"]["preview-unit"].delivered).toBe("35");
  expect(result.values["preview-course:2"]["preview-unit"].delivered).toBe("84");
});
it("未読の必須件数は送信せず、任意の空欄も0件と取り違えない", () => {
  expect(() => buildPhotoReportItems([previewReportCourse], {}, "van")).toThrow("配達完了");
  const optional = { ...previewReportCourse, units: previewReportCourse.units.map(unit => ({ ...unit, fields: unit.fields.map(field => ({ ...field, required: false })) })) };
  expect(buildPhotoReportItems([optional], {}, "van")[0].entries[0].valueNum).toBeNull();
  expect(buildPhotoReportItems([previewReportCourse], { "preview-course:1": { "preview-unit": { delivered: "0" } } }, "van")[0].entries[0].valueNum).toBe(0);
});
