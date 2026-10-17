// /admin/daily の本番ページ・ReportCards をそのまま使用。実在データを含めない。
import type { FixtureRequest } from "@/lib/preview/fixtureStore";
import { missingReportAssignments } from "@/lib/dailyReportGrouping";
import type { DailyReportDisplay } from "@/lib/dailyReportGrouping";
type MockReport = DailyReportDisplay & { id: string; driver_id: string; report_date: string; takuhaibin_completed: number; takuhaibin_returned: number; nekopos_completed: number; nekopos_returned: number };

export function createDailyShiftChange(scenario = "shift-changed") {
  const date = new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  const driver = { id: "fictional-shift-driver", name: "架空 太郎", display_name: "架空 太郎", status: "active" };
  let reports: MockReport[] = ["午前サンプル", "変更後の夜間サンプル", "解除済みサンプル"].map((name, i) => ({
    id: `shift-report-${i}`, driver_id: driver.id, report_date: date, course_id: `shift-course-${i}`,
    course_name: name, course_color: ["#3b82f6", "#f59e0b", "#a855f7"][i], cycle_no: 0, carrier: "YAMATO", submitted_at: `${date}T19:00:00+09:00`,
    rejection_reason: i === 2 ? "shift_changed" as const : null,
    approved_at: null as string | null, rejected_at: i === 2 ? `${date}T20:00:00+09:00` : null,
    vehicle_id: null, meter_value: null, vehicle_plate: null,
    takuhaibin_completed: [80, 40, 40][i], takuhaibin_returned: 0, nekopos_completed: 0, nekopos_returned: 0,
    content: [{ unitId: "fictional-parcel", unitName: "宅急便", fields: [{ fieldKey: "completed", label: "完了", inputType: "INT", groupLabel: null, valueNum: [80, 40, 40][i], valueText: null }] }],
  }));
  if (scenario !== "shift-changed") {
    const plate = { id: "fictional-van", number_prefix: "京都", number_class: "480", number_hiragana: "り", number_numeric: "1234" };
    const first = { ...reports[0], course_name: scenario === "long-name" ? "架空の第一配送センター・午前午後共通の長いコース名" : "日中サンプル", cycle_no: 1, cycle_label: "C1", vehicle_id: plate.id, vehicle_plate: plate, meter_value: 149063 };
    const second = { ...first, id: "shift-report-c2", cycle_no: 2, cycle_label: "C2", content: reports[1].content };
    if (scenario === "different-readings") second.meter_value = 149100;
    if (scenario === "different-vehicles") {
      second.vehicle_id = "fictional-other-van";
      second.vehicle_plate = { ...plate, id: second.vehicle_id, number_numeric: "5678" };
      second.meter_value = 86000;
    }
    reports = [first, second, { ...reports[1], vehicle_id: plate.id, vehicle_plate: plate, meter_value: 149063 }, reports[2]];
    if (scenario === "long-name") driver.display_name = "架空 太郎（第一配送センター応援担当）";
    if (scenario === "large") reports = [...reports.slice(0, 3), ...Array.from({ length: 12 }, (_, index) => ({ ...first, id: `large-report-${index}`, course_id: `large-course-${index}`, course_name: `追加サンプル ${index + 1}` })), reports[3]];
  }
  let assignments = reports.filter(r => !r.rejected_at).map(r => ({ courseId: r.course_id!, cycleNo: r.cycle_no ?? 0, courseName: r.course_name ?? undefined, courseColor: r.course_color ?? null, cycleLabel: r.cycle_label ?? null }));
  if (scenario === "cycle-added") {
    reports = [{ ...reports[0], approved_at: `${date}T19:15:00+09:00` }, reports[3]];
    assignments = [1, 2].map(cycleNo => ({ courseId: reports[0].course_id!, cycleNo, courseName: reports[0].course_name ?? undefined, courseColor: reports[0].course_color ?? null, cycleLabel: `C${cycleNo}` }));
  }
  if (scenario === "mismatch") reports[0] = { ...reports[0], course_id: "wrong-course", course_name: "別コースの提出" };
  if (scenario === "legacy-whole") { assignments = [1,2].map(cycleNo => ({ courseId: reports[0].course_id!, cycleNo, courseName: reports[0].course_name ?? undefined, courseColor: reports[0].course_color ?? null, cycleLabel: `C${cycleNo}` })); reports = [{ ...reports[0], cycle_no: 0, cycle_label: null }]; }
  if (scenario === "duplicate-report") reports.push({ ...reports[0], id: "duplicate-report" });
  return { date, driver, reports, assignments: assignments.length > 1 && assignments[0].courseId === assignments[1].courseId ? [assignments[1],assignments[0],...assignments.slice(2)] : assignments };
}

export function readDailyShiftChange(state: ReturnType<typeof createDailyShiftChange>, { path }: FixtureRequest) {
  const active = state.reports.filter(r => !r.rejected_at);
  if (path === "/api/admin/badges") return { dailyUnread: (active.some(r => !r.approved_at) || missingReportAssignments(state.assignments, active).length > 0) ? 1 : 0, otherUnread: 0 };
  if (path === "/api/admin/daily/day-summary-range") return {
    drivers: [state.driver], days: [{ date: state.date, shiftDriverIds: [state.driver.id],
      shiftAssignmentsByDriver: { [state.driver.id]: state.assignments },
      shiftCoursesByDriver: { [state.driver.id]: [...new Set(active.map(report => report.course_id))] },
      reportsByDriver: { [state.driver.id]: active } }],
  };
  if (path === "/api/admin/daily/report-form") return { shiftVehicleId: active[0]?.vehicle_id ?? null, shifts: state.assignments.map(a => {
    const r = active.find(r => r.course_id === a.courseId && (r.cycle_no ?? 0) === a.cycleNo);
    return { ...a, courseName: active[0]?.course_name ?? "日中サンプル", cycleLabel: `C${a.cycleNo}`, color: null,
      carrierId: null, carrierName: "サンプル配送", units: [{ id: "fictional-parcel", name: "配送", code: "PARCEL", billingType: "PER_PIECE",
        fields: [{ fieldKey: "completed", label: "完了", inputType: "INT", groupLabel: a.cycleNo === 1 ? "午前" : "午後", required: false, sortOrder: 0 }] }],
      existing: r ? { reportId: r.id, approvedAt: r.approved_at, vehicleId: r.vehicle_id, meterValue: r.meter_value,
        values: { "fictional-parcel": { completed: r.content?.[0]?.fields[0]?.valueNum ?? 0 } } } : null };
  }) };
  if (path === "/api/admin/daily/all") return { groups: [{ date: state.date,
    entries: state.reports.map(report => ({ driver: state.driver, report })), assignmentsByDriver: { [state.driver.id]: state.assignments } }] };
  return undefined;
}

export function writeDailyShiftChange(state: ReturnType<typeof createDailyShiftChange>, { path, body }: FixtureRequest) {
  if (path === "/api/admin/daily/reports/proxy") {
    for (const item of body.items as { courseId: string; cycleNo: number; entries: { valueNum: number }[] }[]) {
      if (state.reports.some(r => r.course_id === item.courseId && r.cycle_no === item.cycleNo && r.approved_at)) continue;
      const template = state.reports[0];
      state.reports.push({ ...template, id: "new-cycle-report", cycle_no: item.cycleNo, cycle_label: `C${item.cycleNo}`,
        content: [{ unitId: "fictional-parcel", unitName: "配送", fields: [{ fieldKey: "completed", label: "完了", inputType: "INT", groupLabel: "午後", valueNum: item.entries[0]?.valueNum ?? 0, valueText: null }] }],
        approved_at: new Date().toISOString() });
    }
    return { ok: true };
  }
  const edit = path.match(/^\/api\/admin\/daily\/reports\/([^/]+)$/);
  if (edit) {
    const report = state.reports.find(report => report.id === edit[1]);
    if (!report) throw new Error("日報が見つかりません。");
    if (report.rejected_at) throw new Error("シフトが変更されています。最新のシフトを確認してください。");
    if (Array.isArray(body.entries)) {
      const entries = body.entries as { unitId: string; fieldKey: string; valueNum: number | null; valueText: string | null }[];
      report.content = report.content?.map(unit => ({ ...unit, fields: unit.fields.map(field => {
        const entry = entries.find(entry => entry.unitId === unit.unitId && entry.fieldKey === field.fieldKey);
        return entry ? { ...field, valueNum: entry.valueNum, valueText: entry.valueText } : field;
      }) }));
    }
    report.approved_at = null;
    return { ok: true };
  }
  if (path !== "/api/admin/daily/approve" && path !== "/api/admin/daily/reject") return undefined;
  if (body.driverId !== state.driver.id || body.date !== state.date) throw new Error("日報が見つかりません。");
  for (const report of state.reports.filter(r => !r.rejected_at)) {
    if (!report.approved_at || path.endsWith("/reject")) report.approved_at = path.endsWith("/approve") ? new Date().toISOString() : null;
    if (path.endsWith("/reject")) report.rejected_at = new Date().toISOString();
  }
  return { ok: true, warnings: [] };
}
