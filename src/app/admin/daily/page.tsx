"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DateRangePicker, type DateRangeValue } from "@/lib/components/DateRangePicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";
import { getStoredDriver } from "@/lib/api";
import { faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { VehiclePlate } from "@/lib/components/VehiclePlate";

type ReportData = {
  id?: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
  carrier?: "YAMATO" | "AMAZON";
  approved_at?: string | null;
  rejected_at?: string | null;
  amazon_am_mochidashi?: number;
  amazon_am_completed?: number;
  amazon_pm_mochidashi?: number;
  amazon_pm_completed?: number;
  amazon_4_mochidashi?: number;
  amazon_4_completed?: number;
};

type Entry = {
  driver: { id: string; name: string; display_name?: string | null };
  report: ReportData;
};

type Group = {
  date: string;
  entries: Entry[];
};

type Tab = "pending" | "all";

type VehiclePlatePayload = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

type DaySummaryReport = {
  id: string;
  driver_id: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
  carrier: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  vehicle_id: string | null;
  meter_value: number | null;
  vehicle_plate: VehiclePlatePayload | null;
  amazon_am_mochidashi?: number;
  amazon_am_completed?: number;
  amazon_pm_mochidashi?: number;
  amazon_pm_completed?: number;
  amazon_4_mochidashi?: number;
  amazon_4_completed?: number;
};

type DaySummary = {
  date: string;
  drivers: { id: string; name: string; display_name: string | null }[];
  shiftDriverIds: string[];
  reportsByDriver: Record<string, DaySummaryReport>;
  driverPreferredVehicle?: Record<string, VehiclePlatePayload>;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** JST で午前3時以降か */
function isAfter3AMJST(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(hour, 10) >= 3;
}

/** 選択日が「今日」(JST) の YYYY-MM-DD */
function todayJstYmd(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return `${get("year")}-${get("month").padStart(2, "0")}-${get("day").padStart(2, "0")}`;
}

export default function AdminDailyPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<{ entry: Entry; groupDate: string } | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [allDateRange, setAllDateRange] = useState<DateRangeValue | undefined>(undefined);
  const [pendingDate, setPendingDate] = useState<string>(() => todayYmd());
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);

  const canWrite = canAdminWrite(getStoredDriver()?.role);
  const totalEntries = groups.reduce((sum, g) => sum + g.entries.length, 0);

  const toYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const load = (targetTab: Tab, range?: DateRangeValue, date?: string) => {
    setLoading(true);
    setFetchError(null);
    const cacheOpt = { cache: "no-store" as RequestCache };
    if (targetTab === "pending") {
      const d = date ?? pendingDate;
      apiFetch<DaySummary>(`/api/admin/daily/day-summary?date=${d}`, cacheOpt)
        .then((res) => setDaySummary(res))
        .catch((e) => {
          console.error("[admin/daily] fetch error", e);
          setFetchError(e instanceof Error ? e.message : "日報の取得に失敗しました");
          setDaySummary(null);
        })
        .finally(() => setLoading(false));
    } else {
      const start = range?.startDate ? toYmd(range.startDate) : "";
      const end = range?.endDate ? toYmd(range.endDate) : "";
      const query =
        start && end ? `?start=${start}&end=${end}` : "";
      apiFetch<{ groups: Group[] }>(`/api/admin/daily/all${query}`, cacheOpt)
        .then((res) => setGroups(res.groups ?? []))
        .catch((e) => {
          console.error("[admin/daily] fetch error", e);
          setFetchError(e instanceof Error ? e.message : "日報の取得に失敗しました");
          setGroups([]);
        })
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    if (tab === "pending") {
      load("pending", undefined, pendingDate);
    } else {
      load("all", allDateRange);
    }
  }, [tab, allDateRange, pendingDate]);

  const handleApprove = async (e: Entry, groupDate: string) => {
    try {
      await apiFetch("/api/admin/daily/approve", {
        method: "POST",
        body: JSON.stringify({ driverId: e.driver.id, date: groupDate }),
      });
      if (tab === "pending" && daySummary) {
        load("pending", undefined, pendingDate);
      } else {
        setGroups((prev) =>
          prev
            .map((g) =>
              g.date !== groupDate
                ? g
                : { ...g, entries: g.entries.filter((ent) => ent.driver.id !== e.driver.id) }
            )
            .filter((g) => g.entries.length > 0)
        );
      }
    } catch {
      // noop
    }
  };

  const openEdit = (entry: Entry) => {
    const r = entry.report;
    setEditingEntry({ entry, groupDate: r.report_date });
    setEditForm({
      report_date: r.report_date ?? "",
      takuhaibin_completed: String(r.takuhaibin_completed ?? 0),
      takuhaibin_returned: String(r.takuhaibin_returned ?? 0),
      nekopos_completed: String(r.nekopos_completed ?? 0),
      nekopos_returned: String(r.nekopos_returned ?? 0),
      carrier: r.carrier || "YAMATO",
      amazon_am_mochidashi: String(r.amazon_am_mochidashi ?? 0),
      amazon_am_completed: String(r.amazon_am_completed ?? 0),
      amazon_pm_mochidashi: String(r.amazon_pm_mochidashi ?? 0),
      amazon_pm_completed: String(r.amazon_pm_completed ?? 0),
      amazon_4_mochidashi: String(r.amazon_4_mochidashi ?? 0),
      amazon_4_completed: String(r.amazon_4_completed ?? 0),
    });
  };

  const saveEdit = async () => {
    if (!editingEntry?.entry.report.id) return;
    setSavingEdit(true);
    try {
      const r = editingEntry.entry.report;
      const carrier = editForm.carrier === "AMAZON" ? "AMAZON" : "YAMATO";
      const reportDate = (editForm.report_date ?? "").trim();
      await apiFetch(`/api/admin/daily/reports/${editingEntry.entry.report.id}`, {
        method: "PUT",
        body: JSON.stringify({
          report_date: /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? reportDate : undefined,
          takuhaibin_completed: Number(editForm.takuhaibin_completed) || 0,
          takuhaibin_returned: Number(editForm.takuhaibin_returned) || 0,
          nekopos_completed: Number(editForm.nekopos_completed) || 0,
          nekopos_returned: Number(editForm.nekopos_returned) || 0,
          carrier,
          amazon_am_mochidashi: Number(editForm.amazon_am_mochidashi) || 0,
          amazon_am_completed: Number(editForm.amazon_am_completed) || 0,
          amazon_pm_mochidashi: Number(editForm.amazon_pm_mochidashi) || 0,
          amazon_pm_completed: Number(editForm.amazon_pm_completed) || 0,
          amazon_4_mochidashi: Number(editForm.amazon_4_mochidashi) || 0,
          amazon_4_completed: Number(editForm.amazon_4_completed) || 0,
        }),
      });
      setEditingEntry(null);
      load(tab, tab === "all" ? allDateRange : undefined, tab === "pending" ? pendingDate : undefined);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const isApproved = (r: ReportData) => r.approved_at != null && r.approved_at !== "";
  const isRejected = (r: ReportData) => r.rejected_at != null && r.rejected_at !== "";

  const handleReject = async (e: Entry, groupDate: string) => {
    try {
      await apiFetch("/api/admin/daily/reject", {
        method: "POST",
        body: JSON.stringify({ driverId: e.driver.id, date: groupDate }),
      });
      if (tab === "pending") {
        load("pending", undefined, pendingDate);
      } else {
        load(tab, tab === "all" ? allDateRange : undefined);
      }
    } catch {
      // noop
    }
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-bold text-slate-900">日報集計</h1>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
            >
              未承認
            </button>
            <button
              type="button"
              onClick={() => setTab("all")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
            >
              すべて
            </button>
          </div>
        </div>

        {tab === "pending" && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-1">対象日</label>
            <input
              type="date"
              value={pendingDate}
              onChange={(e) => setPendingDate(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded"
            />
          </div>
        )}

        {tab === "all" && (
          <div className="mb-6">
            <DateRangePicker
              value={allDateRange}
              onChange={setAllDateRange}
            />
          </div>
        )}

        {loading ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-8 w-12 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 px-4"><Skeleton className="h-4 w-12" /></th>
                    <th className="py-3 px-3"><Skeleton className="h-4 w-16 ml-auto" /></th>
                    <th className="py-3 px-3"><Skeleton className="h-4 w-16 ml-auto" /></th>
                    <th className="py-3 px-4"><Skeleton className="h-4 w-16 ml-auto" /></th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(6)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 px-4"><Skeleton className="h-4 w-24" /></td>
                      <td className="py-3 px-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-4"><Skeleton className="h-4 w-14 ml-auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {fetchError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
                日報の取得に失敗しました: {fetchError}
              </div>
            )}

            {tab === "pending" ? (
              (() => {
                const summary = daySummary;
                type Status = "off" | "unsubmitted" | "pending" | "approved";
                const rows = summary
                  ? summary.drivers.map((driver) => {
                      const hasShift = summary.shiftDriverIds.includes(driver.id);
                      const report = summary.reportsByDriver[driver.id];
                      let status: Status = "off";
                      if (!hasShift) status = "off";
                      else if (!report) status = "unsubmitted";
                      else if (report.approved_at) status = "approved";
                      else if (report.rejected_at) status = "off";
                      else status = "pending";
                      return { driver, report: report ?? null, status };
                    })
                  : [];
                const actionableCount = rows.filter((r) => r.status === "unsubmitted" || r.status === "pending").length;
                // 3時以降かつ対象日＝今日のときだけ休み・承認済みをグレーにしない。昨日以前 or 3時前はグレーアウト
                const isTodayAfter3 = summary ? isAfter3AMJST() && summary.date === todayJstYmd() : false;

                return (
                  <>
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="bg-white rounded-lg border border-slate-200 p-4">
                        <div className="text-2xl font-bold text-slate-900">{actionableCount}</div>
                        <div className="text-xs text-slate-500 mt-0.5">要対応（未提出・未承認）</div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-4">
                        <div className="text-2xl font-bold text-slate-900">{summary?.drivers.length ?? 0}</div>
                        <div className="text-xs text-slate-500 mt-0.5">ドライバー数</div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-4">
                        <div className="text-2xl font-bold text-slate-900">
                          {summary?.date ? (() => {
                            const [y, m, d] = summary.date.split("-");
                            return <><span className="text-slate-900 text-base">{y}</span><span className="text-slate-500 text-xs pl-0.5 pr-1">年</span><span className="text-slate-900 text-base">{parseInt(m, 10)}</span><span className="text-slate-500 text-xs pl-0.5 pr-1">月</span><span className="text-slate-900 text-base">{parseInt(d, 10)}</span><span className="text-slate-500 text-xs pl-0.5 pr-1">日</span></>;
                          })() : "/"}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">対象日</div>
                      </div>
                    </div>
                    {!fetchError && summary && rows.length === 0 && (
                      <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
                        ドライバーが登録されていません。
                      </div>
                    )}
                    {!fetchError && summary && rows.length > 0 && (
                      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-sm table-fixed">
                          <colgroup>
                            <col className="w-28" />
                            <col className="w-24" />
                            <col className="w-20" />
                            <col className="w-auto" />
                            <col className="w-36" />
                            {canWrite && <col className="w-20" />}
                            <col className="w-24" />
                          </colgroup>
                          <thead className="bg-slate-50">
                            <tr className="border-b border-slate-200 text-left">
                              <th className="py-3 px-3 font-semibold text-slate-600">名前</th>
                              <th className="py-3 px-2 font-semibold text-slate-600 text-center">車両</th>
                              <th className="py-3 px-2 font-semibold text-slate-600 text-center">メーター</th>
                              <th className="py-3 px-2 font-semibold text-slate-600 text-center">内容</th>
                              <th className="py-3 px-2 font-semibold text-slate-600 text-center">承認</th>
                              {canWrite && <th className="py-3 px-2 font-semibold text-slate-600 text-center">操作</th>}
                              <th className="py-3 px-3 font-semibold text-slate-600 text-right">送信時刻</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(({ driver, report, status }) => {
                              const grayed = status === "off" || status === "approved";
                              const isGray = grayed && !isTodayAfter3;
                              const entry: Entry = {
                                driver: { id: driver.id, name: driver.name, display_name: driver.display_name },
                                report: report as ReportData ?? { report_date: pendingDate, takuhaibin_completed: 0, takuhaibin_returned: 0, nekopos_completed: 0, nekopos_returned: 0, submitted_at: "", carrier: "YAMATO" },
                              };
                              if (report) (entry.report as ReportData).id = report.id;
                              const carrier = report?.carrier || "YAMATO";
                              const vehiclePlate = report?.vehicle_plate ?? summary?.driverPreferredVehicle?.[driver.id] ?? null;
                              return (
                                <tr key={driver.id} className={`border-b border-slate-100 ${isGray ? "bg-slate-100 text-slate-500" : "hover:bg-slate-50"}`}>
                                  <td className="py-3 px-3 font-medium">{getDisplayName(driver)}</td>
                                  <td className="py-2 px-2 align-middle">
                                    {vehiclePlate && (vehiclePlate.number_prefix || vehiclePlate.number_hiragana || vehiclePlate.number_numeric) ? (
                                      <VehiclePlate vehicle={vehiclePlate} compact className="max-w-[100px] mx-auto" />
                                    ) : (
                                      <span className="text-xs text-slate-400">—</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-2 text-center text-xs tabular-nums">{report?.meter_value != null ? report.meter_value.toLocaleString() : "—"}</td>
                                  <td className="py-3 px-2 text-left align-top">
                                    {status === "unsubmitted" && <span className="text-red-600 font-medium">日報が未提出です</span>}
                                    {status === "off" && <span className="text-slate-500">休み</span>}
                                    {status === "approved" && (report ? (carrier === "YAMATO" ? (
                                      <div className="text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0">
                                        <span><span className="text-slate-500 text-xs">宅急便</span> <span className="font-semibold tabular-nums">{report.takuhaibin_completed}</span><span className="text-slate-500 text-xs"> 個</span></span>
                                        <span><span className="text-slate-500 text-xs">ネコポス</span> <span className="font-semibold tabular-nums">{report.nekopos_completed}</span><span className="text-slate-500 text-xs"> 個</span></span>
                                      </div>
                                    ) : (
                                      <div className="text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0">
                                        {report.amazon_am_completed ? <span><span className="text-slate-500 text-xs">午前</span> <span className="font-semibold tabular-nums">{report.amazon_am_completed}</span><span className="text-slate-500 text-xs"> 個</span></span> : null}
                                        {report.amazon_pm_completed ? <span><span className="text-slate-500 text-xs">午後</span> <span className="font-semibold tabular-nums">{report.amazon_pm_completed}</span><span className="text-slate-500 text-xs"> 個</span></span> : null}
                                        {report.amazon_4_completed ? <span><span className="text-slate-500 text-xs">4便</span> <span className="font-semibold tabular-nums">{report.amazon_4_completed}</span><span className="text-slate-500 text-xs"> 個</span></span> : null}
                                      </div>
                                    )) : (<span>—</span>) )}
                                    {status === "pending" && report && (carrier === "YAMATO" ? (
                                      <div className="text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0">
                                        <span><span className="text-slate-500 text-xs">宅急便</span> <span className="font-semibold tabular-nums">{report.takuhaibin_completed}</span><span className="text-slate-500 text-xs"> 個</span></span>
                                        <span><span className="text-slate-500 text-xs">ネコポス</span> <span className="font-semibold tabular-nums">{report.nekopos_completed}</span><span className="text-slate-500 text-xs"> 個</span></span>
                                      </div>
                                    ) : (
                                      <div className="text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0">
                                        {report.amazon_am_completed ? <span><span className="text-slate-500 text-xs">午前</span> <span className="font-semibold tabular-nums">{report.amazon_am_completed}</span><span className="text-slate-500 text-xs"> 個</span></span> : null}
                                        {report.amazon_pm_completed ? <span><span className="text-slate-500 text-xs">午後</span> <span className="font-semibold tabular-nums">{report.amazon_pm_completed}</span><span className="text-slate-500 text-xs"> 個</span></span> : null}
                                        {report.amazon_4_completed ? <span><span className="text-slate-500 text-xs">4便</span> <span className="font-semibold tabular-nums">{report.amazon_4_completed}</span><span className="text-slate-500 text-xs"> 個</span></span> : null}
                                      </div>
                                    ))}
                                  </td>
                                  <td className="py-3 px-2 text-center align-top">
                                    {status === "approved" && <span className="inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700"><FontAwesomeIcon icon={faCircleCheck} className="mr-1" />承認済み</span>}
                                    {status === "pending" && canWrite && (
                                      <div className="flex items-center justify-center gap-2">
                                        <button type="button" onClick={() => handleApprove(entry, summary!.date)} className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-white hover:bg-slate-700">承認</button>
                                        <button type="button" onClick={() => handleReject(entry, summary!.date)} className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">却下</button>
                                      </div>
                                    )}
                                    {status === "pending" && !canWrite && <span className="text-slate-400 text-xs">未承認</span>}
                                    {status === "unsubmitted" && <span className="text-slate-400 text-xs">—</span>}
                                    {status === "off" && <span className="text-slate-400 text-xs">—</span>}
                                  </td>
                                  {canWrite && (
                                    <td className="py-3 px-2 text-center align-top">
                                      {report && (status === "pending" || status === "approved") && (
                                        <button type="button" onClick={() => openEdit(entry)} className="text-sm text-slate-600 hover:text-slate-900 underline">
                                          <FontAwesomeIcon icon={faPenToSquare} />
                                        </button>
                                      )}
                                    </td>
                                  )}
                                  <td className="py-3 px-3 text-right text-xs text-slate-400 align-middle">
                                    {report?.submitted_at ? (
                                      <span className="tabular-nums">{new Date(report.submitted_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
                                    ) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-2xl font-bold text-slate-900">{totalEntries}</div>
                    <div className="text-xs text-slate-500 mt-0.5">全件数</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-2xl font-bold text-slate-900">{groups.length}</div>
                    <div className="text-xs text-slate-500 mt-0.5">対象日数</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-2xl font-bold text-slate-900">
                      {groups.length > 0 && groups[0].date && groups[0].date !== "-" ? (
                        (() => {
                          const [y, m, d] = groups[0].date.split("-");
                          return (
                            <>
                              <span className="text-slate-900 text-base">{y}</span>
                              <span className="text-slate-500 text-xs pl-0.5 pr-1">年</span>
                              <span className="text-slate-900 text-base">{parseInt(m, 10)}</span>
                              <span className="text-slate-500 text-xs pl-0.5 pr-1">月</span>
                              <span className="text-slate-900 text-base">{parseInt(d, 10)}</span>
                              <span className="text-slate-500 text-xs pl-0.5 pr-1">日</span>
                            </>)
                      })()
                  ) : (
                    "/"
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">最新の日付</div>
              </div>
            </div>

                {!fetchError && groups.length === 0 && (
                  <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
                    日報はありません。
                  </div>
                )}

            {groups.map((group) => (
              <div key={group.date} className="mb-8">
                <h2 className="text-sm font-semibold text-slate-800 mb-2">
                  {group.date === "/" ? "---" : (() => {
                    return (
                      <>
                        <span className="text-slate-900 text-xs">
                          <>
                            <span className="text-slate-900 text-base">{group.date.split("-")[0]}</span>
                            <span className="text-slate-500 text-xs pl-0.5 pr-1">年</span>
                            <span className="text-slate-900 text-base">{parseInt(group.date.split("-")[1], 10)}</span>
                            <span className="text-slate-500 text-xs pl-0.5 pr-1">月</span>
                            <span className="text-slate-900 text-base">{parseInt(group.date.split("-")[2], 10)}</span>
                            <span className="text-slate-500 text-xs pl-0.5 pr-1">日</span>
                          </>
                        </span>
                        <span className="text-slate-500 text-xs"> ({group.entries.length} 件)</span>
                      </>
                    )
                  })()}
                </h2>
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      {/* 名前 */}
                      <col className="w-32" />
                      {/* 種別 */}
                      <col className="w-20" />
                      {/* 内容（可変） */}
                      <col className="w-auto" />
                      {/* 承認 */}
                      <col className="w-36" />
                      {/* 操作（allタブのみ表示だが列幅は固定） */}
                      {tab === "all" && canWrite && <col className="w-20" />}
                      {/* 送信時刻 */}
                      <col className="w-24" />
                    </colgroup>
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left">
                        <th className="py-3 px-4 font-semibold text-slate-600">名前</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center">種別</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center">内容</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center">承認</th>
                        {tab === "all" && canWrite && (
                          <th className="py-3 px-3 font-semibold text-slate-600 text-center">操作</th>
                        )}
                        <th className="py-3 px-4 font-semibold text-slate-600 text-right">送信時刻</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((e) => {
                        const r = e.report;
                        const carrier = r.carrier || "YAMATO";
                        const approved = isApproved(r);
                        const rejected = isRejected(r);

                        return (
                          <tr key={`${e.driver.id}-${group.date}`} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-3 px-4 font-medium align-middle">{getDisplayName(e.driver)}</td>
                            <td className="py-3 px-3 text-center align-middle">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${carrier === "AMAZON"
                                  ? "bg-violet-100 text-violet-700"
                                  : "bg-emerald-100 text-emerald-700"
                                  }`}
                              >
                                {carrier === "AMAZON" ? "Amazon" : "ヤマト"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-left align-top">
                              {carrier === "YAMATO" ? (
                                <div className="text-[13px] pl-6">
                                  <span className="text-slate-500 text-xs">宅急便</span>{" "}
                                  <span className="font-semibold text-slate-900 text-base tabular-nums">{r.takuhaibin_completed}</span>
                                  <span className="text-slate-500 text-xs pr-3"> 個</span>
                                  <span className="text-slate-500 text-xs">ネコポス</span>{" "}
                                  <span className="font-semibold text-slate-900 text-base tabular-nums">{r.nekopos_completed}</span>
                                  <span className="text-slate-500 text-xs"> 個</span>
                                </div>
                              ) : (() => {
                                const am = r.amazon_am_completed ?? 0;
                                const pm = r.amazon_pm_completed ?? 0;
                                const four = r.amazon_4_completed ?? 0;
                                const fourOnly = am === 0 && pm === 0 && four > 0;
                                return fourOnly ? (
                                  <div className="text-[13px] pl-6">
                                    <span className="text-slate-500 text-xs">4便</span>{" "}
                                    <span className="font-semibold text-slate-900 text-base tabular-nums">{four}</span>
                                    <span className="text-slate-500 text-xs"> 個</span>
                                  </div>
                                ) : (
                                  <div className="text-[13px] pl-6 flex flex-wrap items-baseline gap-x-3 gap-y-0">
                                    {am > 0 && (
                                      <span>
                                        <span className="text-slate-500 text-xs">午前</span>{" "}
                                        <span className="font-semibold text-slate-900 text-base tabular-nums">{am}</span>
                                        <span className="text-slate-500 text-xs"> 個</span>
                                      </span>
                                    )}
                                    {pm > 0 && (
                                      <span>
                                        <span className="text-slate-500 text-xs">午後</span>{" "}
                                        <span className="font-semibold text-slate-900 text-base tabular-nums">{pm}</span>
                                        <span className="text-slate-500 text-xs"> 個</span>
                                      </span>
                                    )}
                                    {four > 0 && (
                                      <span>
                                        <span className="text-slate-500 text-xs">4便</span>{" "}
                                        <span className="font-semibold text-slate-900 text-base tabular-nums">{four}</span>
                                        <span className="text-slate-500 text-xs"> 個</span>
                                      </span>
                                    )}
                                    {am === 0 && pm === 0 && four === 0 && (
                                      <span className="text-slate-400 text-xs">—</span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-3 px-3 text-center align-top">
                              {approved ? (
                                <span className="inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700" title="承認済み">
                                  <FontAwesomeIcon icon={faCircleCheck} className="mr-1" />
                                  <span className="text-slate-500 text-xs">承認済み</span>
                                </span>
                              ) : rejected ? (
                                <span className="inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700">
                                  却下
                                </span>
                              ) : canWrite ? (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleApprove(e, group.date)}
                                    className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-white hover:bg-slate-700"
                                  >
                                    承認
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReject(e, group.date)}
                                    className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
                                  >
                                    却下
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-xs">未承認</span>
                              )}
                            </td>
                            {tab === "all" && canWrite && (
                              <td className="py-3 px-3 text-center align-top">
                                <button
                                  type="button"
                                  onClick={() => openEdit(e)}
                                  className="text-sm text-slate-600 hover:text-slate-900 underline"
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} />
                                </button>
                              </td>
                            )}
                            <td className="py-3 px-6 text-right text-xs text-slate-400 align-middle">
                              <span className="text-slate-900 text-base tabular-nums">
                                {new Date(r.submitted_at).toLocaleTimeString("ja-JP", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
                </>
              )}
          </>
        )}
      </div>

      {/* 編集モーダル */}
      {editingEntry && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">
                日報の編集 — {getDisplayName(editingEntry.entry.driver)}
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                承認済みの日報を編集すると、売上・報酬・集計にもその内容が反映されます。
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">日付</label>
                  <input
                    type="date"
                    value={editForm.report_date ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, report_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">種別</label>
                  <CustomSelect
                    options={[
                      { value: "YAMATO", label: "ヤマト" },
                      { value: "AMAZON", label: "Amazon" },
                    ]}
                    value={editForm.carrier ?? "YAMATO"}
                    onChange={(v) => setEditForm((f) => ({ ...f, carrier: v }))}
                    clearable={false}
                    size="sm"
                  />
                </div>
                {editForm.carrier === "YAMATO" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">宅急便 完了</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.takuhaibin_completed ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, takuhaibin_completed: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">宅急便 持戻</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.takuhaibin_returned ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, takuhaibin_returned: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">ネコポス 完了</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.nekopos_completed ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, nekopos_completed: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">ネコポス 持戻</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.nekopos_returned ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, nekopos_returned: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午前 持出</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_am_mochidashi ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_am_mochidashi: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午前 完了</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_am_completed ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_am_completed: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午後 持出</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_pm_mochidashi ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_pm_mochidashi: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午後 完了</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_pm_completed ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_pm_completed: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">4便 持出</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_4_mochidashi ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_4_mochidashi: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">4便 完了</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_4_completed ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_4_completed: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50"
                >
                  {savingEdit ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
