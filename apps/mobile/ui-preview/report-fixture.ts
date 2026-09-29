import type { ReportItem, ShiftForm } from "@repo/core/types";
import { previewVehicle } from "./vehicle";
import { previewHomeCourse } from "./home-course";
export const previewReportCourse: ShiftForm = { courseId: "preview-course", cycleNo: 1, cycleLabel: "1便", courseName: previewHomeCourse.name, color: previewHomeCourse.color, carrierId: "preview-carrier", carrierName: "サンプル配送", units: [{ id: "preview-unit", name: "通常便", code: "normal", billingType: "PER_PIECE", fields: [{ fieldKey: "delivered", label: "配達完了", inputType: "INT", groupLabel: null, required: true }] }], existing: null };
const reports = new Map<string, ReportItem[]>();
let failure = false;
export const setPreviewReportFailure = (value: boolean) => { failure = value; };
export function previewReportForm(date: string) {
  const item = reports.get(date)?.find(item => item.courseId === previewReportCourse.courseId && item.cycleNo === previewReportCourse.cycleNo);
  const values: Record<string, Record<string, number | string>> = {};
  for (const entry of item?.entries ?? []) (values[entry.unitId] ??= {})[entry.fieldKey] = entry.valueNum ?? entry.valueText ?? "";
  return { shifts: [{ ...previewReportCourse, existing: item ? { vehicleId: item.vehicleId, meterValue: item.meterValue, values } : null }], shiftVehicleId: previewVehicle.id };
}
export function savePreviewReport(body: { reportDate?: string; items?: (Omit<ReportItem, "meterValue"> & { meterValue?: number | null })[] }) {
  if (failure) throw new Error("日報を送信できませんでした。もう一度送信してください。");
  if (body.reportDate && body.items) reports.set(body.reportDate, body.items.map(item => ({ ...item, meterValue: "meterValue" in item ? item.meterValue ?? null : reports.get(body.reportDate!)?.find(previous => previous.courseId === item.courseId && previous.cycleNo === item.cycleNo)?.meterValue ?? null })));
}
