import { orderCourseCycles } from "./reportCycles";
import type { DailyReportDisplay } from "./dailyReportGrouping";
export type ShiftReportAssignment = { courseId: string; cycleNo: number; courseName?: string; courseColor?: string | null; cycleLabel?: string | null };
export type ShiftReportComparison = { assignment: ShiftReportAssignment | null; reports: DailyReportDisplay[]; status: "matched" | "missing" | "unexpected" | "duplicate" | "legacy" | "fields" | "unknown" };

/** 名称で照合しない。同名の別コース・別便、旧全体、重複、設定外数量を区別する。 */
export function compareShiftReports(assignments: ShiftReportAssignment[], reports: DailyReportDisplay[]): ShiftReportComparison[] {
  const active = reports.filter(r => !r.rejected_at);
  const used = new Set<DailyReportDisplay>();
  const rows: ShiftReportComparison[] = [];
  const unique = orderCourseCycles([...new Map(assignments.map(a => [`${a.courseId}:${a.cycleNo}`, a])).values()], a => a.courseId, a => a.cycleNo);
  for (const assignment of unique) {
    const exact = active.filter(r => r.course_id === assignment.courseId && (Number(r.cycle_no) || 0) === assignment.cycleNo);
    const wholeDay = active.filter(r => r.course_id === assignment.courseId && !(Number(r.cycle_no) || 0));
    const legacy = !exact.length && assignment.cycleNo > 0 && !active.some(r => r.course_id === assignment.courseId && (Number(r.cycle_no) || 0) > 0) ? wholeDay : [];
    const matching = exact.length ? exact : legacy;
    matching.forEach(r => used.add(r));
    if (legacy.length && legacy.every(r => used.has(r)) && rows.some(row => row.status === "legacy" && row.reports[0] === legacy[0])) {
      const prior = rows.find(row => row.status === "legacy" && row.reports[0] === legacy[0])!;
      prior.assignment = { ...prior.assignment!, cycleNo: 0, cycleLabel: `${prior.assignment?.cycleLabel || `C${prior.assignment?.cycleNo}`}・${assignment.cycleLabel || `C${assignment.cycleNo}`}` };
      continue;
    }
    const review = matching.some(r => r.content?.some(u => u.fields.some(f => f.needsReview)));
    rows.push({ assignment, reports: matching, status: !matching.length ? "missing" : matching.length > 1 ? "duplicate" : legacy.length ? "legacy" : review ? "fields" : !assignment.courseName ? "unknown" : "matched" });
  }
  for (const report of orderCourseCycles(active, r => r.course_id ?? "", r => r.cycle_no ?? 0)) if (!used.has(report)) rows.push({ assignment: null, reports: [report], status: "unexpected" });
  return rows;
}
export const shiftReportStatusLabel: Record<ShiftReportComparison["status"], string> = {
  matched: "シフトと一致", missing: "未提出", unexpected: "該当シフトなし", duplicate: "重複を確認", legacy: "全体日報・要確認", fields: "入力欄を確認", unknown: "コース名を確認",
};
