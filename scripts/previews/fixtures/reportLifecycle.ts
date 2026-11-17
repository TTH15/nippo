// 本番ページ/共通表示部品の操作用データ。外部接続はせず、プレビュー専用キーだけへ保存する。
import { reportDateDefaultJST } from "@/lib/date";
import type { ShiftForm } from "@repo/core/types";
import type { FixtureRequest } from "@/lib/preview/fixtureStore";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const FLOW_DRIVER = id(3);
const KEY = "hakotora_preview_report_lifecycle_v2";
export const isReportFlow = (scenario: string) => ["course-add", "correction", "finalization"].includes(scenario);
const base: ShiftForm = { courseId: id(101), courseName: "豊中サンプル", cycleNo: 1, cycleLabel: "C1", color: "#fbbf24", carrierId: "carrier-1", carrierName: "プレビュー運輸", units: [{ id: "unit-1", name: "宅配", code: "PARCEL", billingType: "PER_PIECE", fields: [{ fieldKey: "completed", label: "完了", inputType: "INT", groupLabel: "個数", required: true }] }], existing: null };
export const flowCandidates: ShiftForm[] = [{ ...base, cycleNo: 2, cycleLabel: "C2" }, { ...base, courseId: id(102), courseName: "吹田サンプル", cycleNo: 0, cycleLabel: null, color: "#38bdf8" }];
type FlowItem = { courseId: string; cycleNo: number; entries: { unitId: string; fieldKey: string; valueNum: number | null; valueText: string | null }[]; vehicleId?: string | null; meterValue?: number | null; request?: boolean; removed?: boolean; id: string };
type FlowShift = { id: string; shift_date: string; course_id: string; cycle_no: number; slot: number; driver_id: string | null; vehicle_id: string | null };
type Flow = { shifts?: FlowShift[]; date: string; revision: number; reports: FlowItem[]; requests: FlowItem[]; rejected: boolean; approved: boolean; finalized: boolean; correction: string | null };
export function loadReportFlow(scenario: string): Flow {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Flow; } catch { /* 初期状態 */ }
  const date = scenario === "correction" ? new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10) : reportDateDefaultJST();
  return { date, revision: 1, reports: scenario === "correction" || scenario === "finalization" ? [{ id: "flow-report-1", courseId: base.courseId, cycleNo: 1, meterValue: 50063, vehicleId: "veh-1", entries: [{ unitId: "unit-1", fieldKey: "completed", valueNum: 63, valueText: null }] }] : [], requests: [], rejected: false, approved: scenario !== "course-add", finalized: scenario === "correction", correction: null };
}
function save(flow: Flow) { flow.revision++; localStorage.setItem(KEY, JSON.stringify(flow)); }
export function resetReportFlow() { localStorage.removeItem(KEY); }
export function advanceReportFlow() {
  const flow = loadReportFlow("course-add");
  if (!flow.approved || flow.requests.length || flow.correction) throw new Error("日報を承認してから確定してください");
  flow.finalized = true; save(flow);
}
function formFor(item: FlowItem): ShiftForm {
  const form = [base, ...flowCandidates].find(s => s.courseId === item.courseId && s.cycleNo === item.cycleNo) ?? base;
  return { ...form, ...(item.request ? { requestId: item.id } : {}), existing: { vehicleId: item.vehicleId ?? null, meterValue: item.meterValue ?? null, values: Object.fromEntries(form.units.map(u => [u.id, Object.fromEntries(item.entries.filter(e => e.unitId === u.id).map(e => [e.fieldKey, e.valueNum ?? e.valueText ?? ""]))])) } };
}
function display(item: FlowItem, flow: Flow) {
  const form = formFor(item);
  return { id: item.id, driver_id: FLOW_DRIVER, report_date: flow.date, course_id: item.courseId, course_name: form.courseName, course_color: form.color, cycle_no: item.cycleNo, cycle_label: form.cycleLabel, carrier: "OTHER", carrier_name: "プレビュー運輸", vehicle_id: item.vehicleId ?? null, meter_value: item.meterValue ?? null, submitted_at: `${flow.date}T10:00:00+09:00`, approved_at: flow.approved && !item.removed ? `${flow.date}T12:00:00+09:00` : null, rejected_at: item.removed ? `${flow.date}T13:00:00+09:00` : null, rejection_reason: item.removed ? "shift_changed" : null,
    content: form.units.map(u => ({ unitId: u.id, unitName: u.name, fields: item.entries.filter(e => e.unitId === u.id).map(e => ({ fieldKey: e.fieldKey, label: "完了", groupLabel: "個数", inputType: "INT", valueNum: e.valueNum, valueText: e.valueText })) })) };
}
export function readReportFlow(request: FixtureRequest, scenario: string): unknown {
  if (!isReportFlow(scenario)) return undefined;
  const flow = loadReportFlow(scenario);
  const { path, params } = request;
  const reports = flow.reports.map(i => display(i, flow));
  const driver = { id: FLOW_DRIVER, name: "鈴木 大輔", display_name: null, status: "active" };
  const assigned = [{ courseId: base.courseId, courseName: base.courseName, courseColor: base.color, cycleNo: 1 }, ...flow.reports.filter(i => !i.removed && !(i.courseId === base.courseId && i.cycleNo === 1)).map(i => ({ courseId: i.courseId, courseName: formFor(i).courseName, courseColor: formFor(i).color, cycleNo: i.cycleNo }))];
  if (path === "/api/me/report-form") {
    const matched = params.get("date") === flow.date;
    const forms = matched && flow.reports.length ? flow.reports.filter(i => !i.removed).map(formFor) : [base];
    return { shifts: [...forms, ...(matched ? flow.requests : []).map(i => formFor({ ...i, request: true }))], candidates: flowCandidates, revision: String(flow.revision), rejectedRequests: flow.rejected ? [{ id: "rejected", courseName: "豊中サンプル", cycleNo: 2 }] : [], shiftVehicleId: "veh-1" };
  }
  if (path === "/api/admin/daily/course-requests") return { days: flow.requests.length ? [{ driverId: FLOW_DRIVER, driverName: driver.name, date: flow.date, revision: String(flow.revision), reports: reports.map(r => ({ id: r.id, courseName: r.course_name, cycleNo: r.cycle_no, content: r.content, approved: flow.approved })), requests: flow.requests.map(i => ({ id: i.id, courseName: formFor(i).courseName, cycleNo: i.cycleNo, content: display(i, flow).content, meterValue: i.meterValue })) }] : [] };
  if (path === "/api/admin/daily/day-summary-range") return { drivers: [driver], days: [{ date: flow.date, shiftDriverIds: [FLOW_DRIVER], shiftAssignmentsByDriver: { [FLOW_DRIVER]: assigned }, reportsByDriver: { [FLOW_DRIVER]: reports.filter(r => !r.rejected_at) } }] };
  if (path === "/api/admin/daily/all") return { groups: [{ date: flow.date, entries: reports.map(report => ({ driver, report })), assignmentsByDriver: { [FLOW_DRIVER]: assigned } }] };
  if (path === "/api/admin/badges") return { dailyUnread: flow.approved && !flow.requests.length ? 0 : 1, otherUnread: 0 };
  if (path === "/api/admin/shifts/corrections") return { sessions: flow.correction ? [{ id: flow.correction, driver_id: FLOW_DRIVER, shift_date: flow.date }] : [], finalized: flow.finalized ? [{ driver_id: FLOW_DRIVER, report_date: flow.date }] : [] };
  return undefined;
}
export function writeReportFlow(request: FixtureRequest, scenario: string, role: string): unknown {
  if (!isReportFlow(scenario)) return undefined;
  const { path, body, method } = request;
  const flow = loadReportFlow(scenario);
  if (["/api/admin/shifts", "/api/admin/shifts/times", "/api/admin/shifts/vehicle"].includes(path) && body.shiftDate === flow.date) {
    if (role !== "admin" || !flow.correction) throw new Error("シフトの修正を開始してください");
    const rows = flowShiftRows(scenario).rows;
    const current = rows.find(r => r.course_id === body.courseId && r.cycle_no === (body.cycleNo ?? 0) && r.slot === (body.slot ?? 1));
    if (path === "/api/admin/shifts" && (body.driverId === null || body.driverId === FLOW_DRIVER)) {
      if (body.driverId === null && current) {
        flow.shifts = rows.filter(r => r !== current);
        flow.reports = flow.reports.map(r => r.courseId === current.course_id && r.cycleNo === current.cycle_no ? { ...r, removed: true } : r);
      } else if (!current) {
        flow.shifts = [...rows, { id: `flow-added-${flow.revision}`, shift_date: flow.date, course_id: String(body.courseId), cycle_no: Number(body.cycleNo ?? 0), slot: Number(body.slot ?? 1), driver_id: FLOW_DRIVER, vehicle_id: null }];
      }
      flow.approved = false; flow.finalized = false; save(flow); return { shift: current ?? {} };
    }
    if (current) {
      flow.shifts = rows.map(r => r === current ? { ...r, ...body, ...(path.endsWith("vehicle") ? { vehicle_id: body.vehicleId as string | null } : {}) } : r);
      save(flow); return { shift: current };
    }
  }
  if (path === "/api/reports/v2") {
    if (body.expectedRevision !== String(flow.revision)) throw new Error("日報が変更されています。再読み込みしてください");
    if (flow.finalized && !flow.correction) throw new Error("確定済みの日報です。管理者に修正を依頼してください");
    const items = body.items as FlowItem[];
    flow.date = String(body.reportDate); flow.reports = items.filter(i => !i.request).map((i, n) => ({ ...i, id: `flow-report-${n + 1}` }));
    flow.requests = items.filter(i => i.request).map((i, n) => ({ ...i, id: `flow-request-${n + 1}` }));
    flow.approved = false; flow.rejected = false; save(flow);
    return { ok: true, reportIds: flow.reports.map(r => r.id), requestIds: flow.requests.map(r => r.id), parkingSaved: true };
  }
  if (path === "/api/reports/course-requests" && method === "DELETE") {
    const id = request.params.get("id");
    if (!flow.requests.some(q => q.id === id)) throw new Error("申請はすでに処理されています");
    flow.requests = flow.requests.filter(q => q.id !== id); save(flow); return { ok: true, revision: String(flow.revision) };
  }
  if (path === "/api/admin/daily/approve" || path === "/api/admin/daily/reject") {
    if (role !== "admin") throw new Error("権限がありません");
    if (flow.requests.length && body.expectedRevision !== String(flow.revision)) throw new Error("追加申請を確認してから承認してください");
    if (path.endsWith("approve")) { flow.reports.push(...flow.requests.map(i => ({ ...i, request: false }))); flow.approved = true; }
    else { flow.reports = []; flow.approved = false; flow.rejected = true; }
    flow.requests = []; save(flow); return { ok: true, warnings: [] };
  }
  if (path.startsWith("/api/admin/daily/reports/") && method === "PUT") {
    if (role !== "admin" || flow.finalized) throw new Error("シフトの修正を開始してください");
    const report = flow.reports.find(i => path.endsWith(i.id));
    if (!report) throw new Error("日報が見つかりません");
    report.entries = body.entries as FlowItem["entries"]; flow.approved = false; save(flow); return { ok: true };
  }
  if (path === "/api/admin/shifts/corrections") {
    if (role !== "admin") throw new Error("権限がありません");
    if (method === "POST") {
      if (flow.correction) throw new Error("すでに修正中です");
      flow.correction = "flow-correction"; flow.approved = false; flow.finalized = false; save(flow); return { id: flow.correction };
    }
    if (!flow.approved || flow.requests.length) throw new Error("日報を承認してから確定してください");
    flow.correction = null; flow.finalized = true; save(flow); return { ok: true };
  }
  return undefined;
}
export function flowShiftRows(scenario: string) {
  const flow = loadReportFlow(scenario);
  return { date: flow.date, rows: flow.shifts ?? [{ ...base, id: "flow-shift-1" }, ...flow.reports.filter(i => !i.removed && !(i.courseId === base.courseId && i.cycleNo === 1)).map(formFor)].map((f, n) => ({ id: `flow-shift-${n}`, shift_date: flow.date, course_id: f.courseId, cycle_no: f.cycleNo ?? 0, slot: f.courseId === id(102) ? 2 : 1, driver_id: FLOW_DRIVER, vehicle_id: id(201) })) };
}
