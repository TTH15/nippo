"use client";

// 日報報告ページのスマホ用カード表示部品。
// PC はテーブル、スマホ・タブレット（< lg）はカードで表示する。

import { CourseChip } from "@/lib/components/CourseChip";
import { reportCycleTone } from "@/lib/reportCycles";
import { compareShiftReports, shiftReportStatusLabel, type ShiftReportAssignment, type ShiftReportComparison } from "@/lib/shiftReportComparison";
import { useId, useState } from "react";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { dailyCourseGroups, dailyVehicleReadings, dailyReportStatus, type DailyReportDisplay } from "@/lib/dailyReportGrouping";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { ReportVehicleNumber } from "@/lib/components/ReportVehicleNumber";
import type { ReportVehicleNumber as NumberEvidence } from "@/lib/reportVehicleNumber";
import { getDisplayName } from "@/lib/displayName";
import { carrierBadgeLabel, carrierBadgeTone } from "@/lib/carrierBadge";
import { ReportContentView } from "@/lib/components/ReportContentView";
import type { ReportContentUnit } from "@/lib/reportContent";

type DriverLike = { id: string; name: string; display_name?: string | null };

type VehiclePlatePayload = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

export type ReportLike = DailyReportDisplay;

const fmtTime = (s?: string) =>
  s ? new Date(s).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "—";

/** 便（C1/C2）バッジ。同じコースの日報が複数行並ぶとき、どの便かを見分けるために出す。 */
export function CycleBadge({ label, cycleNo = 0 }: { label?: string | null; cycleNo?: number }) {
  if (!label) return null;
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${reportCycleTone(cycleNo).badge}`}>
      {label}
    </span>
  );
}

export function CarrierBadge({
  carrier,
  carrierName,
  muted,
}: {
  carrier?: string | null;
  carrierName?: string | null;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${carrierBadgeTone(carrier, carrierName, muted)}`}
    >
      {carrierBadgeLabel(carrier, carrierName)}
    </span>
  );
}

/** 配送内容。送信画面と同じ動的 unit/field 構造で表示する。 */
export function ReportContent({ r, muted }: { r: ReportLike; muted?: boolean }) {
  return <ReportContentView units={r.content} muted={muted} />;
}


function CardShell({ muted, children }: { muted?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-3 ${muted ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"}`}>
      {children}
    </div>
  );
}

/** 車両とメーターは1人1日で共通表示。異なる記録値は保持する。 */
export function DailyVehicleReadings({ reports }: { reports: ReportLike[] }) {
  const active = reports.filter(report => !report.rejected_at);
  const readings = dailyVehicleReadings(active.length ? active : reports);
  if (!readings.length) return <span className="text-xs text-slate-400">—</span>;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    {readings.map(({ key, report, meters }) => <div key={key} className="flex min-w-0 flex-wrap items-center gap-2">
      <ReportVehicleNumber report={report} />
      {meters.length > 0 && <span className="text-xs tabular-nums text-slate-600">{meters.map(value => value.toLocaleString()).join(" / ")}<span className="ml-1 text-[10px] text-slate-500">km</span></span>}
    </div>)}
  </div>;
}

export function ReportSubmissionTimes({ reports }: { reports: ReportLike[] }) {
  const active = reports.filter(report => !report.rejected_at);
  const times = [...new Set((active.length ? active : reports).map(report => fmtTime(report.submitted_at)))];
  return <span className="text-[11px] tabular-nums text-slate-400">{times.join(" / ") || "—"}</span>;
}

/** コース名・車両・送信時刻を便ごとに繰り返さず、実績と編集対象の便を対応させる。 */
function CourseReports({ reports, muted, canWrite, onEdit, showStatus }: {
  reports: ReportLike[]; muted?: boolean; canWrite: boolean; onEdit: (report: ReportLike) => void; showStatus?: boolean;
}) {
  return <div className="space-y-3">
    {dailyCourseGroups(reports).map(group => <div key={group.key}>
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <CarrierBadge carrier={group.report.carrier} carrierName={group.report.carrier_name} muted={muted} />
        {group.report.course_name && <CourseChip name={group.report.course_name} color={group.report.course_color} />}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {group.reports.map((report, index) => <div key={report.id ?? index} className="min-w-0 flex items-start gap-2">
          <CycleBadge label={report.cycle_label} cycleNo={report.cycle_no ?? 0} />
          <ReportContent r={report} muted={muted} />
          {showStatus && <span className={`text-[10px] whitespace-nowrap ${report.rejected_at ? "text-rose-600" : report.approved_at ? "text-emerald-700" : "text-slate-500"}`}>{report.rejected_at ? (report.rejection_reason === "shift_changed" ? "シフト変更で対象外" : "却下") : report.approved_at ? "承認済み" : "未承認"}</span>}
          {canWrite && report.rejection_reason !== "shift_changed" && <button type="button" onClick={() => onEdit(report)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-900" aria-label={`${report.course_name ?? "日報"}${report.cycle_label ? ` ${report.cycle_label}` : ""}を編集`}>
            <FontAwesomeIcon icon={faPenToSquare} />
          </button>}
        </div>)}
      </div>
    </div>)}
  </div>;
}

function ComparisonAssignment({ row }: { row: ShiftReportComparison }) {
  return <div className="min-w-0 space-y-1 text-xs">
    <div>{row.assignment ? <CourseChip name={row.assignment.courseName || "コース名未確認"} color={row.assignment.courseColor} /> : <span className="text-slate-500">該当シフトなし</span>}</div>
    {row.assignment && <CycleBadge label={row.assignment.cycleLabel || (row.assignment.cycleNo ? `C${row.assignment.cycleNo}` : null)} cycleNo={row.assignment.cycleNo} />}
  </div>;
}
function ComparisonSubmission({ row, canWrite, onEdit }: { row: ShiftReportComparison; canWrite: boolean; onEdit: (r: ReportLike) => void }) {
  return <div className="min-w-0 space-y-1 text-xs">
    {row.reports.map((report,i) => <div key={report.id ?? i} className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5"><CourseChip name={report.course_name || "コース未設定"} color={report.course_color} />
        <CycleBadge label={report.cycle_label || ((report.cycle_no ?? 0) > 0 ? `C${report.cycle_no}` : null)} cycleNo={report.cycle_no ?? 0} />
        {canWrite && report.rejection_reason !== "shift_changed" && <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-slate-900"
          aria-label={`${report.course_name ?? "日報"}${report.cycle_label ? ` ${report.cycle_label}` : ""}を編集`} onClick={() => onEdit(report)}><FontAwesomeIcon icon={faPenToSquare} /></button>}
      </div>
      <ReportContent r={report} />
    </div>)}
    {row.status !== "matched" && <span className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold ${row.status === "unexpected" || row.status === "duplicate" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>
      {shiftReportStatusLabel[row.status]}
    </span>}
  </div>;
}
export function ShiftReportComparisonView({ assignments, reports, canWrite, onEdit }: {
  assignments: ShiftReportAssignment[]; reports: ReportLike[]; canWrite: boolean; onEdit: (r: ReportLike) => void;
}) {
  const rows = compareShiftReports(assignments, reports);
  if (!rows.length) return null;
  return <div className="space-y-2" aria-label="シフトと日報の照合">
    {rows.map((row,index) => <div key={index} className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-2 last:border-0">
      <ComparisonAssignment row={row} /><ComparisonSubmission row={row} canWrite={canWrite} onEdit={onEdit} />
    </div>)}
  </div>;
}
function ReportHistory({ reports, canWrite, onEdit }: { reports: ReportLike[]; canWrite: boolean; onEdit: (report: ReportLike) => void }) {
  const [open,setOpen] = useState(false);
  const id = useId();
  if(!reports.length) return null;
  return <div className="mt-2 border-t border-slate-100 pt-1">
    <button type="button" className="min-h-11 text-xs text-slate-500 underline underline-offset-2" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>対象外・却下（{reports.length}）</button>
    <SmoothCollapse open={open} id={id}><CourseReports reports={reports} muted canWrite={canWrite} onEdit={onEdit} showStatus /></SmoothCollapse>
  </div>;
}
export function DailyReportContents({ reports, muted, canWrite, onEdit, history = false, assignments }: {
  reports: ReportLike[]; muted?: boolean; canWrite: boolean; onEdit: (report: ReportLike) => void; history?: boolean; assignments?: ShiftReportAssignment[];
}) {
  const active = reports.filter(report => !report.rejected_at);
  const mixed = active.some(report => !!report.approved_at) && active.some(report => !report.approved_at);
  return <>
    {assignments ? <ShiftReportComparisonView assignments={assignments} reports={active} canWrite={canWrite} onEdit={onEdit} /> : <CourseReports reports={active} muted={muted} canWrite={canWrite} onEdit={onEdit} showStatus={mixed} />}
    {history && <ReportHistory reports={reports.filter(r => !!r.rejected_at)} canWrite={canWrite} onEdit={onEdit} />}
  </>;
}

type DailyStatus = "off" | "unsubmitted" | "approved" | "pending" | "rejected" | "excluded";
type DailyGroupProps = {
  driver: DriverLike; reps: ReportLike[]; assignments?: ShiftReportAssignment[]; status: DailyStatus; needsProxy?: boolean; canWrite: boolean;
  onApprove: () => void; onReject: () => void; onEdit: (report: ReportLike) => void; onProxyEntry?: () => void; history?: boolean;
};

function DailyDecision({ status, needsProxy, canWrite, onApprove, onReject, assignments, reps }: Pick<DailyGroupProps, "status" | "needsProxy" | "canWrite" | "onApprove" | "onReject" | "assignments" | "reps">) {
  const blocked = assignments && compareShiftReports(assignments, reps).some(row => ["unexpected", "duplicate", "fields", "unknown"].includes(row.status));
  if (status === "pending" && canWrite && blocked) return <span className="text-xs font-medium text-amber-800">シフト・入力欄を確認</span>;
  if (status === "pending" && canWrite) return <div className="flex items-center gap-2">
    <button type="button" onClick={onApprove} className="min-h-11 rounded-full bg-slate-800 px-4 text-xs font-semibold text-white hover:bg-slate-700">承認</button>
    <button type="button" onClick={onReject} className="min-h-11 rounded-full bg-slate-100 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-200">却下</button>
  </div>;
  if (status === "approved") return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${needsProxy ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{!needsProxy && <FontAwesomeIcon icon={faCircleCheck} className="mr-1" />}{needsProxy ? "一部未提出" : "承認済み"}</span>;
  return <span className={`text-xs ${status === "rejected" ? "text-rose-600" : "text-slate-400"}`}>{status === "pending" ? "未承認" : status === "rejected" ? "却下" : status === "excluded" ? "対象外" : "—"}</span>;
}

function ProxyEntry({ canWrite, needsProxy, onProxyEntry }: Pick<DailyGroupProps, "canWrite" | "needsProxy" | "onProxyEntry">) {
  return canWrite && needsProxy && onProxyEntry ? <button type="button" onClick={onProxyEntry} className="min-h-11 whitespace-nowrap rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200">代理入力</button> : null;
}

/** 未承認・全件とも1人1日のカード。コースと便はカード内の実績として並べる。 */
export function PendingDriverCard(props: DailyGroupProps) {
  const { driver, reps, status, needsProxy, canWrite, onEdit, history, assignments } = props;
  const muted = status === "off" || (status === "approved" && !needsProxy);
  return <CardShell muted={muted}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="font-semibold text-slate-900">{getDisplayName(driver)}</span>
      <ReportSubmissionTimes reports={reps} />
    </div>
    {reps.length > 0 && <div className="mb-3"><DailyVehicleReadings reports={reps} /></div>}
    {status === "unsubmitted" && !assignments && <span className="text-xs font-semibold text-red-600">日報が未提出です</span>}
    {status === "off" && reps.length === 0 && <span className="text-xs text-slate-500">休み</span>}
    <DailyReportContents assignments={assignments} reports={reps} muted={muted} canWrite={canWrite && (history === true || status === "pending" || status === "approved")} onEdit={onEdit} history={history} />
    {needsProxy && !assignments && reps.length > 0 && <p className="mt-2 text-[11px] font-semibold text-red-600">未提出のコース・便があります</p>}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><DailyDecision {...props} /><ProxyEntry {...props} /></div>
  </CardShell>;
}

export function AllReportCard(props: Omit<DailyGroupProps, "status">) {
  return <PendingDriverCard {...props} status={dailyReportStatus(props.reps)} history />;
}

/** PCでも1人1日を1行にし、コース別の編集は実績のそばに置く。 */
export function DailyReportTable({ children }: { children: React.ReactNode }) {
  return <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white lg:block"><div className="overflow-x-auto table-scroll">
    <table className="w-full min-w-[820px] text-sm"><thead className="bg-slate-50"><tr className="border-b border-slate-200 text-left text-xs text-slate-600">
      <th className="w-28 px-3 py-3 font-semibold">名前</th><th className="w-44 px-3 py-3 font-semibold">車両・メーター</th><th className="w-1/4 px-3 py-3 font-semibold">シフト</th><th className="px-3 py-3 font-semibold">提出された日報</th><th className="w-36 px-3 py-3 font-semibold">承認</th><th className="w-24 px-3 py-3 text-right font-semibold">送信時刻</th>
    </tr></thead><tbody>{children}</tbody></table>
  </div></div>;
}

export function DailyDriverRow(props: DailyGroupProps) {
  const { driver, reps, status, needsProxy, canWrite, onEdit, history, assignments } = props;
  const muted = status === "off" || (status === "approved" && !needsProxy);
  const editable = canWrite && (history === true || status === "pending" || status === "approved");
  const rows = assignments ? compareShiftReports(assignments,reps) : [];
  const rejected = history ? reps.filter(r => !!r.rejected_at) : [];
  const hasHistory = rows.length > 0 && rejected.length > 0;
  const displayRows = rows.length ? rows : [null];
  const span = displayRows.length + (hasHistory ? 1 : 0);
  return <>{displayRows.map((row,index) => <tr key={index} className={`${index === displayRows.length - 1 && !hasHistory ? "border-b border-slate-200" : "border-b border-slate-100"} ${muted ? "bg-slate-50 text-slate-500" : "hover:bg-slate-50"}`}>
    {index === 0 && <>
      <td rowSpan={span} className="px-3 py-3 align-middle font-medium">{getDisplayName(driver)}</td>
      <td rowSpan={span} className="px-3 py-3 align-middle"><DailyVehicleReadings reports={reps} /></td>
    </>}
    <td className="px-3 py-3 align-middle">{row ? <ComparisonAssignment row={row} /> : <span className="text-xs text-slate-500">{status === "off" && !reps.length ? "休み" : "—"}</span>}</td>
    <td className="px-3 py-3 align-middle">{row ? <ComparisonSubmission row={row} canWrite={editable} onEdit={onEdit} /> : <>
      {status === "unsubmitted" && <span className="text-xs font-semibold text-red-600">日報が未提出です</span>}
      <DailyReportContents reports={reps} muted={muted} canWrite={editable} onEdit={onEdit} history={history} />
      {needsProxy && reps.length > 0 && <p className="mt-2 text-[11px] font-semibold text-red-600">未提出のコース・便があります</p>}
    </>}</td>
    {index === 0 && <>
      <td rowSpan={span} className="px-3 py-3 align-middle"><div className="flex flex-col items-start gap-2"><DailyDecision {...props} /><ProxyEntry {...props} /></div></td>
      <td rowSpan={span} className="px-3 py-3 text-right align-middle"><ReportSubmissionTimes reports={reps} /></td>
    </>}
  </tr>)}
  {hasHistory && <tr className="border-b border-slate-200"><td colSpan={2} className="px-3 py-1"><ReportHistory reports={rejected} canWrite={editable} onEdit={onEdit} /></td></tr>}
  </>;
}
