import { expect, it } from "vitest";
import { compareShiftReports } from "./shiftReportComparison";
const shifts = [{ courseId: "a", courseName: "日中", cycleNo: 1, cycleLabel: "C1" }, { courseId: "a", courseName: "日中", cycleNo: 2, cycleLabel: "C2" }];
it("コース名でなく所属コースIDと便で一致を判定する", () => {
  const rows = compareShiftReports(shifts, [{ course_id: "a", cycle_no: 1 }, { course_id: "other", course_name: "日中", cycle_no: 2 }]);
  expect(rows.map(r => r.status)).toEqual(["matched", "missing", "unexpected"]);
});
it("解除履歴は一致や重複に含めない", () => {
  expect(compareShiftReports(shifts.slice(0,1), [{ course_id: "a", cycle_no: 1, rejected_at: "old" }, { course_id: "a", cycle_no: 1 }])[0].status).toBe("matched");
});
it("同じ便への二重提出は一致にしない", () => {
  expect(compareShiftReports(shifts.slice(0,1), [{ course_id: "a", cycle_no: 1 }, { course_id: "a", cycle_no: 1 }])[0].status).toBe("duplicate");
});
it("旧全体日報は数量を重複表示せず、両便の予定と1件の全体日報を対応させる", () => {
  const rows = compareShiftReports(shifts, [{ course_id: "a", cycle_no: 0 }]);
  expect(rows).toHaveLength(1); expect(rows[0].status).toBe("legacy"); expect(rows[0].assignment?.cycleLabel).toBe("C1・C2");
});
it("便別と旧全体が混在すれば、全体の方をシフト外として確認する", () => {
  const rows = compareShiftReports(shifts, [{ course_id: "a", cycle_no: 0 }, { course_id: "a", cycle_no: 1 }]);
  expect(rows.map(r => r.status)).toEqual(["matched", "missing", "unexpected"]);
});
it("設定外の実績や照合元のコース名が無い場合は一致表示を出さない", () => {
  const content = [{ unitId: "u", unitName: "配送", fields: [{ fieldKey: "pm", label: "完了", inputType: "INT", groupLabel: "午後", valueNum: 5, valueText: null, needsReview: true }] }];
  expect(compareShiftReports(shifts.slice(0,1), [{ course_id: "a", cycle_no: 1, content }])[0].status).toBe("fields");
  expect(compareShiftReports([{ courseId: "a", cycleNo: 1 }], [{ course_id: "a", cycle_no: 1 }])[0].status).toBe("unknown");
});
