import { expect, it } from "vitest";
import { closeoutProgress, finishWork, submitDayReport, nextPreviewShiftDate } from "../ui-preview/end-of-day";
import { previewReportForm, savePreviewReport, setPreviewReportFailure } from "../ui-preview/report-fixture";
import { buildReportItems, buildInitialValues } from "@repo/core/logic/dailyReport";

it("終了と日報完了を分離し、別の日の日報成功では完了しない", () => {
  const day = finishWork("2026-09-23", "2026-09-24");
  expect(day.report).toBe("pending");
  expect(submitDayReport(day, "2026-09-24")).toBe(day);
  expect(submitDayReport(day, "2026-09-23")).toEqual({ ...day, report: "submitted" });
  expect(submitDayReport(null, "2026-09-23")).toBeNull();
  expect(nextPreviewShiftDate("2026-09-30")).toBe("2026-10-02");
});
it("実フォームのコース・便payloadを保存し、失敗時には日報を保存しない", () => {
  const date = "2026-09-23", form = previewReportForm(date);
  const values = buildInitialValues(form.shifts);
  values["preview-course:1"] = { "preview-unit": { delivered: "84" } };
  const items = buildReportItems(form.shifts, values, form.shiftVehicleId, 12410);
  expect(items[0]).toMatchObject({ courseId: "preview-course", cycleNo: 1, entries: [{ valueNum: 84 }] });
  setPreviewReportFailure(true);
  try {
    expect(() => savePreviewReport({ reportDate: date, items })).toThrow("送信できません");
    expect(previewReportForm(date).shifts[0].existing).toBeNull();
  } finally { setPreviewReportFailure(false); }
  savePreviewReport({ reportDate: date, items });
  expect(previewReportForm(date).shifts[0].existing).toMatchObject({ meterValue: 12410, values: { "preview-unit": { delivered: 84 } } });
});

it("日報と駐車が順不同で揃った時だけ完了し、位置不明でも写真受理で完了する", () => {
  const pending = finishWork("2026-09-24", "2026-09-24");
  const sent = submitDayReport(pending, "2026-09-24")!;
  expect(closeoutProgress(pending, "pending")).toMatchObject({ complete: false, remaining: 2 });
  expect(closeoutProgress(sent, "pending")).toMatchObject({ complete: false, remaining: 1 });
  expect(closeoutProgress(pending, "located")).toMatchObject({ complete: false, remaining: 1 });
  expect(closeoutProgress(sent, "located")).toMatchObject({ complete: true, remaining: 0 });
  expect(closeoutProgress(sent, "unlocated").complete).toBe(true);
  expect(closeoutProgress(sent, null).complete).toBe(false);
});
