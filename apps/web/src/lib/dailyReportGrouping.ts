import type { ReportContentUnit } from "./reportContent";
import { reportVehicleNumber, type ReportVehicleNumber } from "./reportVehicleNumber";
import type { VehiclePlateData } from "@repo/core/types";

export type DailyReportDisplay = {
  id?: string;
  course_id?: string | null;
  course_name?: string | null;
  cycle_no?: number | null;
  cycle_label?: string | null;
  carrier?: string | null;
  carrier_name?: string | null;
  content?: ReportContentUnit[];
  submitted_at?: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: "shift_changed" | null;
  vehicle_id?: string | null;
  vehicle_plate?: VehiclePlateData | null;
  vehicle_number_evidence?: ReportVehicleNumber | null;
  vehicle_number_unavailable?: boolean;
  meter_value?: number | null;
};

/** 同一人物・同日・同車両・同値だけを除く。別人や異なる読取値を日単位で潰さない。 */
export function deduplicateMeterReports<T extends {
  report_date: string; driver_id: string; vehicle_id: string | null; meter_value: number | null;
}>(reports: T[]): T[] {
  const seen = new Set<string>();
  return reports.filter(report => {
    if (!report.vehicle_id || report.meter_value == null) return true;
    const key = JSON.stringify([report.report_date, report.driver_id, report.vehicle_id, report.meter_value]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 名前でまとめると同姓同名が混ざるため、日付で分けた後に所属IDでまとめる。 */
export function groupDailyEntries<D extends { id: string }, R>(entries: { driver: D; report: R }[]) {
  const groups = new Map<string, { driver: D; reports: R[] }>();
  for (const { driver, report } of entries) {
    const group = groups.get(driver.id) ?? { driver, reports: [] };
    group.reports.push(report);
    groups.set(driver.id, group);
  }
  return [...groups.values()];
}

export function dailyCourseGroups<T extends DailyReportDisplay>(reports: T[]) {
  const groups = new Map<string, { key: string; report: T; reports: T[] }>();
  for (const report of reports) {
    const key = report.course_id ?? JSON.stringify([report.carrier, report.course_name]);
    const group = groups.get(key) ?? { key, report, reports: [] };
    group.reports.push(report);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, reports: [...group.reports].sort((a, b) => (a.cycle_no ?? 0) - (b.cycle_no ?? 0)) }));
}

/** 1人1日の表示専用。車両未特定の行は、値だけで同じ車と推測しない。 */
export function dailyVehicleReadings<T extends DailyReportDisplay>(reports: T[]) {
  const groups = new Map<string, { key: string; report: T; meters: number[] }>();
  reports.forEach((report, index) => {
    const number = reportVehicleNumber(report.content) ?? report.vehicle_number_evidence;
    const key = report.vehicle_id ?? report.vehicle_plate?.id
      ?? (number ? `number:${number.source}:${number.number}` : `unknown:${report.id ?? index}`);
    const group = groups.get(key) ?? { key, report, meters: [] };
    if (report.vehicle_plate?.number_numeric || (!group.report.vehicle_plate?.number_numeric && number)) group.report = report;
    if (report.meter_value != null && Number.isFinite(report.meter_value) && !group.meters.includes(report.meter_value)) group.meters.push(report.meter_value);
    groups.set(key, group);
  });
  return [...groups.values()];
}

export function dailyReportStatus(reports: DailyReportDisplay[]) {
  const active = reports.filter(report => !report.rejected_at);
  if (!active.length) return reports.length && reports.every(r => r.rejection_reason === "shift_changed") ? "excluded" as const : "rejected" as const;
  return active.every(report => !!report.approved_at) ? "approved" as const : "pending" as const;
}

/** 旧全体日報だけが残る場合はコース全体の提出として扱う。便別が混在すれば便を一致させる。 */
export function missingReportAssignments(assignments: { courseId: string; cycleNo: number }[], reports: DailyReportDisplay[]) {
  const active = reports.filter(r => !r.rejected_at);
  return assignments.filter(a => !active.some(r => r.course_id === a.courseId &&
    ((Number(r.cycle_no) || 0) === a.cycleNo || (!(Number(r.cycle_no) || 0) &&
      !active.some(other => other.course_id === a.courseId && (Number(other.cycle_no) || 0) > 0)))));
}
