import { expect, it } from "vitest";
import { deduplicateMeterReports, dailyVehicleReadings, groupDailyEntries, dailyCourseGroups, dailyReportStatus } from "./dailyReportGrouping";

const row = { report_date: "2026-10-16", driver_id: "driver", vehicle_id: "van", meter_value: 149063 };
it("C1/C2にコピーされた同じ読取値を1件にし、63km/0kmの重複差分を作らない", () => {
  const unique = deduplicateMeterReports([{ ...row, report_date: "2026-10-15", meter_value: 149000 }, row, { ...row }]);
  expect(unique.map(report => report.meter_value)).toEqual([149000, 149063]);
  expect(unique.slice(1).map((report, index) => report.meter_value - unique[index].meter_value)).toEqual([63]);
});
it("異なる値・別利用者・別車両・別日・車両未特定の記録を消さない", () => {
  const reports = [row, { ...row, meter_value: 149100 }, { ...row, driver_id: "peer" }, { ...row, vehicle_id: "other-van" }, { ...row, report_date: "2026-10-17" }, { ...row, vehicle_id: null }, { ...row, vehicle_id: null }];
  expect(deduplicateMeterReports(reports)).toEqual(reports);
});
it("0kmの実際の読取値を欠測扱いにしない", () => {
  expect(deduplicateMeterReports([{ ...row, meter_value: 0 }, { ...row, meter_value: 0 }])).toHaveLength(1);
});
it("日報表示で車両と同値を共通化し、乗換えや別の値は表示に残す", () => {
  const groups = dailyVehicleReadings([row, { ...row }, { ...row, meter_value: 149100 }, { ...row, vehicle_id: "other" }]);
  expect(groups.map(group => group.meters)).toEqual([[149063, 149100], [149063]]);
});
it("同姓同名を混ぜず、便は同じコース内でC1/C2順にまとめる", () => {
  const c2 = { id: "c2", course_id: "course", cycle_no: 2 }, c1 = { id: "c1", course_id: "course", cycle_no: 1 };
  const groups = groupDailyEntries([{ driver: { id: "a", name: "架空" }, report: c2 }, { driver: { id: "a", name: "架空" }, report: c1 }, { driver: { id: "b", name: "架空" }, report: c1 }]);
  expect(groups).toHaveLength(2);
  expect(dailyCourseGroups(groups[0].reports)[0].reports.map(report => report.id)).toEqual(["c1", "c2"]);
});
it("却下履歴を現行の承認状態に混ぜない", () => {
  expect(dailyReportStatus([{ approved_at: "approved" }, { rejected_at: "removed" }])).toBe("approved");
  expect(dailyReportStatus([{ approved_at: "approved" }, {}])).toBe("pending");
  expect(dailyReportStatus([{ rejected_at: "removed" }])).toBe("rejected");
});

it("便の追加はその便だけ未提出。旧全体日報だけの過去日には二重提出を求めない", async () => {
  const { missingReportAssignments } = await import("./dailyReportGrouping");
  const assignments = [{ courseId: "course", cycleNo: 1 }, { courseId: "course", cycleNo: 2 }];
  expect(missingReportAssignments(assignments, [{ course_id: "course", cycle_no: 1, approved_at: "approved" }])).toEqual([assignments[1]]);
  expect(missingReportAssignments(assignments, [{ course_id: "course", cycle_no: 0 }])).toEqual([]);
  expect(missingReportAssignments(assignments, [{ course_id: "course", cycle_no: 0 }, { course_id: "course", cycle_no: 1 }])).toEqual([assignments[1]]);
  expect(missingReportAssignments(assignments, [{ course_id: "course", cycle_no: 1 }, { course_id: "course", cycle_no: 2, rejected_at: "removed" }])).toEqual([assignments[1]]);
});
