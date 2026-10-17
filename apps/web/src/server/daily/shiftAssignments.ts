import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShiftReportAssignment } from "@/lib/shiftReportComparison";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
export const SHIFT_ASSIGNMENT_SELECT = "shift_date, driver_id, course_id, cycle_no, courses!inner(id, org_id, name, color, summary_title, course_cycles(cycle_no, label))";
export function shiftAssignment(row: any): ShiftReportAssignment {
  const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
  const cycleNo = Number(row.cycle_no) || 0;
  return { courseId: row.course_id, cycleNo, courseName: course?.name ?? undefined, courseColor: course?.color ?? null,
    cycleLabel: course?.course_cycles?.find((c: any) => Number(c.cycle_no) === cycleNo)?.label ?? (cycleNo ? `C${cycleNo}` : null) };
}
export async function loadShiftAssignments(db: SupabaseClient, org: string, driverIds: string[], dates: string[]) {
  const result = new Map<string, Record<string, ShiftReportAssignment[]>>();
  if (!driverIds.length || !dates.length) return result;
  for (let d = 0; d < dates.length; d += IN_CLAUSE_BATCH_SIZE) for (let i = 0; i < driverIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const rows = await fetchAllRows<any>((from, to) => db
      // tenant-scope-ok: 自社の日報から作ったdriverIds・datesで限定し、親coursesの会社も照合
      .from("shifts").select(SHIFT_ASSIGNMENT_SELECT).eq("courses.org_id", org)
      .in("driver_id", driverIds.slice(i, i + IN_CLAUSE_BATCH_SIZE)).in("shift_date", dates.slice(d, d + IN_CLAUSE_BATCH_SIZE))
      .order("id").range(from, to));
    for (const row of rows) {
      if (!row.driver_id || !row.course_id) continue;
      const byDriver = result.get(row.shift_date) ?? {};
      const assignments = byDriver[row.driver_id] ?? [];
      const assignment = shiftAssignment(row);
      if (!assignments.some(a => a.courseId === assignment.courseId && a.cycleNo === assignment.cycleNo)) assignments.push(assignment);
      byDriver[row.driver_id] = assignments; result.set(row.shift_date, byDriver);
    }
  }
  return result;
}
