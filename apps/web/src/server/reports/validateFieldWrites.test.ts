import { expect, it } from "vitest";
import { validateReportFieldWrites } from "./validateFieldWrites";
const filters = [{ course_id: "course", cycle_no: 1, unit_id: "unit", field_key: "am" }, { course_id: "course", cycle_no: 2, unit_id: "unit", field_key: "pm" }];
function db(previous: unknown[] = [], failed = false) {
  return { from(table: string) {
    const q: any = { select: () => q, eq: () => q, in: () => q,
      then: (resolve: any) => Promise.resolve({ data: table === "courses" ? [{ id: "course" }] : table === "course_report_fields" ? filters : previous,
        error: failed && table === "course_report_fields" ? new Error("unavailable") : null }).then(resolve) };
    return q;
  } } as never;
}
const item = (fieldKey: string, valueNum: number, cycleNo = 1) => [{ courseId: "course", cycleNo, entries: [{ unitId: "unit", fieldKey, valueNum }] }];
const reports = [{ id: "report", course_id: "course", cycle_no: 1 }];
it("午前はC1、午後はC2だけに保存できる", async () => {
  expect(await validateReportFieldWrites(db(), "org", item("am", 80), reports)).toBeNull();
  expect(await validateReportFieldWrites(db(), "org", item("pm", 40, 2), reports)).toBeNull();
  expect(await validateReportFieldWrites(db(), "org", item("pm", 40), reports)).toContain("便の設定");
  expect(await validateReportFieldWrites(db(), "org", item("four", 40), reports)).toContain("便の設定");
});
it("既存の設定外数量をフォームから消す再送を止め、管理者による0への訂正は許可する", async () => {
  const previous = [{ report_id: "report", unit_id: "unit", field_key: "pm", value_num: 7, value_text: null }];
  expect(await validateReportFieldWrites(db(previous), "org", item("am", 80), reports)).toContain("便の設定");
  expect(await validateReportFieldWrites(db(previous), "org", item("pm", 7), reports, true)).toBeNull();
  expect(await validateReportFieldWrites(db(previous), "org", item("pm", 8), reports, true)).toContain("便の設定");
  expect(await validateReportFieldWrites(db(previous), "org", item("pm", 0), reports, true)).toBeNull();
});
it("設定の読取失敗を全項目許可にしない", async () => {
  await expect(validateReportFieldWrites(db([], true), "org", item("pm", 40), reports)).rejects.toThrow("unavailable");
});
