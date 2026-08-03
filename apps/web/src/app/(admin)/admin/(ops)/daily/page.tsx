"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DateRangePicker, type DateRangeValue } from "@/lib/components/DateRangePicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { getDisplayName } from "@/lib/displayName";
import { carrierBadgeLabel, carrierBadgeTone } from "@/lib/carrierBadge";
import { ReportContentView } from "@/lib/components/ReportContentView";
import type { ReportContentUnit } from "@/lib/reportContent";
import { hasCapability } from "@/lib/capabilities";
import { getStoredDriver } from "@/lib/api";
import { faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { reportDateDefaultJST } from "@/lib/date";
import type { SelectOption } from "@/lib/components/CustomSelect";
import { OtherReportsContent } from "../misc-reports/others/OtherReportsContent";
import { PendingDriverCard, AllReportCard } from "./ReportCards";
import type { EditEntryValue } from "./EditReportModal";

const EditReportModal = dynamic(() => import("./EditReportModal"), {
  ssr: false,
  loading: () => null,
});

const ProxyReportModal = dynamic(() => import("./ProxyReportModal"), {
  ssr: false,
  loading: () => null,
});

type ReportData = {
  id?: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
  carrier?: "YAMATO" | "AMAZON";
  carrier_name?: string | null;
  course_name?: string | null;
  content?: ReportContentUnit[];
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
  course_id?: string | null;
  course_name?: string | null;
  content?: ReportContentUnit[];
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
  carrier: string | null;
  carrier_id?: string | null;
  carrier_name?: string | null;
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
  drivers: { id: string; name: string; display_name: string | null; status?: string | null }[];
  shiftDriverIds: string[];
  shiftCoursesByDriver?: Record<string, string[]>;
  reportsByDriver: Record<string, DaySummaryReport[]>;
  driverPreferredVehicle?: Record<string, VehiclePlatePayload>;
};

export default function AdminDailyPage() {
  const [reportTab, setReportTab] = useState<"daily" | "other">("daily");
  const [tab, setTab] = useState<Tab>("pending");
  const [groups, setGroups] = useState<Group[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [approveWarnings, setApproveWarnings] = useState<string[]>([]);
  const [editingEntry, setEditingEntry] = useState<{ entry: Entry; groupDate: string } | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [allDateRange, setAllDateRange] = useState<DateRangeValue | undefined>(undefined);
  const [daySummaries, setDaySummaries] = useState<DaySummary[]>([]);
  const [proxyTarget, setProxyTarget] = useState<{ driverId: string; driverName: string; date: string } | null>(null);

  const canWrite = hasCapability("can_edit_reports");
  const totalEntries = groups.reduce((sum, g) => sum + g.entries.length, 0);
  const businessToday = reportDateDefaultJST();

  const toYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // SWR でタブ別にキャッシュし、画面遷移をまたいで保持する（再訪時の点滅をなくす）。
  // pending=要対応（期間で切らず全履歴の未提出・未承認） / all=全件（日付範囲指定）。
  // 非アクティブなタブは取得しない。
  const pendingKey = tab === "pending" ? "/api/admin/daily/day-summary-range?pending=1" : null;
  const allKey =
    tab === "all"
      ? `/api/admin/daily/all${
          allDateRange?.startDate && allDateRange?.endDate
            ? `?start=${toYmd(allDateRange.startDate)}&end=${toYmd(allDateRange.endDate)}`
            : ""
        }`
      : null;

  const pendingApi = useApi<{ days: DaySummary[] }>(pendingKey);
  const allApi = useApi<{ groups: Group[] }>(allKey);

  // 上部タブ（日報/その他の報告）の要対応件数。タブに関係なく常に取得する。
  const dailyUnreadApi = useApi<{ unreadCount: number }>("/api/admin/daily/unread-count");
  const miscUnreadApi = useApi<{ unreadCount: number }>(
    "/api/admin/misc-reports/oil-change/unread-count",
  );
  const dailyActionableCount = dailyUnreadApi.data?.unreadCount ?? 0;
  const miscActionableCount = miscUnreadApi.data?.unreadCount ?? 0;

  // 取得結果を既存 state に同期する（楽観更新の setGroups を温存するため state は維持）。
  useEffect(() => {
    if (pendingApi.data) {
      setDaySummaries(pendingApi.data.days ?? []);
      setFetchError(null);
    }
  }, [pendingApi.data]);
  useEffect(() => {
    if (pendingApi.error) {
      setDaySummaries([]);
      setFetchError(
        pendingApi.error instanceof Error ? pendingApi.error.message : "日報の取得に失敗しました",
      );
    }
  }, [pendingApi.error]);
  useEffect(() => {
    if (allApi.data) {
      setGroups(allApi.data.groups ?? []);
      setFetchError(null);
    }
  }, [allApi.data]);
  useEffect(() => {
    if (allApi.error) {
      setGroups([]);
      setFetchError(
        allApi.error instanceof Error ? allApi.error.message : "日報の取得に失敗しました",
      );
    }
  }, [allApi.error]);

  // 初回（キャッシュ未取得）のみスケルトン。再訪・キャッシュ済みタブ切替では点滅しない。
  const loading = tab === "pending" ? pendingApi.isInitialLoading : allApi.isInitialLoading;

  // 書き込み後の再取得（旧 load の代替）。range はキーから導出するため引数では無視。
  const load = useCallback(
    (targetTab: Tab, _range?: DateRangeValue): Promise<unknown> => {
      // 日報の承認/却下/代理入力/編集後はタブの要対応件数も更新
      void dailyUnreadApi.mutate();
      return targetTab === "pending" ? pendingApi.mutate() : allApi.mutate();
    },
    [pendingApi, allApi, dailyUnreadApi],
  );

  const handleApprove = async (e: Entry, groupDate: string) => {
    try {
      const res = await apiFetch<{ ok?: boolean; warnings?: string[] }>("/api/admin/daily/approve", {
        method: "POST",
        body: JSON.stringify({ driverId: e.driver.id, date: groupDate }),
      });
      setApproveWarnings(res?.warnings ?? []);
      if (tab === "pending") {
        load("pending");
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "承認に失敗しました";
      setFetchError(msg);
    }
  };

  const openEdit = (entry: Entry) => {
    const r = entry.report;
    setEditSaveError(null);
    setEditingEntry({ entry, groupDate: r.report_date });
    setEditForm({
      report_date: r.report_date ?? "",
      status: r.approved_at
        ? "approved"
        : r.rejected_at
          ? "rejected"
          : "",
    });
  };

  const openProxy = (driver: { id: string; name: string; display_name?: string | null }, date: string) => {
    setProxyTarget({ driverId: driver.id, driverName: getDisplayName(driver), date });
  };

  const saveEdit = async (entries: EditEntryValue[] | undefined) => {
    if (!editingEntry?.entry.report.id) {
      setEditSaveError("日報IDが取得できません。画面を再読み込みしてください。");
      return;
    }
    setSavingEdit(true);
    setEditSaveError(null);
    try {
      const originalReport = editingEntry.entry.report;
      const originalStatus = originalReport.approved_at
        ? "approved"
        : originalReport.rejected_at
          ? "rejected"
          : "";
      const desiredStatusRaw = editForm.status as string | undefined;
      // 未選択(変更しない)なら元のステータスを維持。PUTで承認はリセットされるため後で再適用する。
      const desiredStatus =
        desiredStatusRaw === "approved" || desiredStatusRaw === "rejected"
          ? desiredStatusRaw
          : originalStatus;

      const reportDate = (editForm.report_date ?? "").trim();
      await apiFetch(`/api/admin/daily/reports/${editingEntry.entry.report.id}`, {
        method: "PUT",
        body: JSON.stringify({
          report_date: /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? reportDate : undefined,
          // 動的フォームの値（report_entries 縦持ち）。undefined のときは項目を変更しない。
          entries,
        }),
      });

      const effectiveDate =
        /^\d{4}-\d{2}-\d{2}$/.test(reportDate) && reportDate
          ? reportDate
          : originalReport.report_date;

      // 編集でヘッダの承認状態はリセットされるため、選択ステータスを必ず再適用する。
      if (desiredStatus === "approved") {
        await apiFetch("/api/admin/daily/approve", {
          method: "POST",
          body: JSON.stringify({ driverId: editingEntry.entry.driver.id, date: effectiveDate }),
        });
      } else if (desiredStatus === "rejected") {
        await apiFetch("/api/admin/daily/reject", {
          method: "POST",
          body: JSON.stringify({ driverId: editingEntry.entry.driver.id, date: effectiveDate }),
        });
      }

      await load(tab, tab === "all" ? allDateRange : undefined);
      setEditingEntry(null);
    } catch (err) {
      console.error(err);
      setEditSaveError(err instanceof Error ? err.message : "保存に失敗しました");
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
        load("pending");
      } else {
        load(tab, tab === "all" ? allDateRange : undefined);
      }
    } catch {
      // noop
    }
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex gap-6 border-b border-slate-200">
        <button type="button" onClick={() => setReportTab("daily")} className={`relative pb-2.5 text-sm font-medium inline-flex items-center gap-1.5 ${reportTab === "daily" ? "text-amber-600" : "text-slate-600 hover:text-slate-900"}`}>
          日報
          {dailyActionableCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-none tabular-nums">
              {dailyActionableCount}
            </span>
          )}
          {reportTab === "daily" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-600" />}
        </button>
        <button type="button" onClick={() => setReportTab("other")} className={`relative pb-2.5 text-sm font-medium inline-flex items-center gap-1.5 ${reportTab === "other" ? "text-amber-600" : "text-slate-600 hover:text-slate-900"}`}>
          その他の報告
          {miscActionableCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-none tabular-nums">
              {miscActionableCount}
            </span>
          )}
          {reportTab === "other" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-600" />}
        </button>
      </div>
      {reportTab === "other" ? (
        <OtherReportsContent onMutated={() => void miscUnreadApi.mutate()} />
      ) : (
      <>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-bold text-slate-900">日報報告</h1>
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

        {tab === "all" && (
          <div className="mb-6">
            {/* 過去の閲覧は1ヶ月単位で十分（半年・1年プリセットは撤去。2026-08-02 決定） */}
            <DateRangePicker
              value={allDateRange}
              onChange={setAllDateRange}
              presets={["last_month", "current_month", "custom"]}
            />
          </div>
        )}

        {tab === "pending" && (
          <p className="mb-6 text-xs text-slate-500">
            未提出・未承認の日報は、期間に関係なくすべて表示されます（過去分の代理入力もここから）。
          </p>
        )}

        {loading ? (
          <>
            <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                  <Skeleton className="h-8 w-12 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            {/* 日付見出し＋一覧。スマホはカード、PC はテーブルと表示形が違うので
                スケルトンも同じ分岐で出し分ける（読み込み後にレイアウトが動かない）。 */}
            {[0, 1].map((d) => (
              <div key={d} className="mb-8">
                <Skeleton className="h-5 w-52 mb-2" />
                {/* スマホ: カード */}
                <div className="md:hidden space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-6 w-20 rounded-full" />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                      <Skeleton className="h-4 w-40 mt-2" />
                    </div>
                  ))}
                </div>
                {/* PC: テーブル（列構成は実表と同じ 名前/種別/車両/メーター/内容/承認/操作/送信時刻） */}
                <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-28" />
                      <col className="w-20" />
                      <col className="w-40" />
                      <col className="w-24" />
                      <col className="w-auto" />
                      <col className="w-36" />
                      {canWrite && <col className="w-24" />}
                      <col className="w-24" />
                    </colgroup>
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left">
                        {["名前", "種別", "車両", "メーター", "内容", "承認", ...(canWrite ? ["操作"] : []), "送信時刻"].map(
                          (h) => (
                            <th key={h} className="py-3 px-2 font-semibold text-slate-600">
                              <Skeleton className="h-4 w-12" />
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {[...Array(4)].map((_, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-3 px-3"><Skeleton className="h-4 w-20" /></td>
                          <td className="py-3 px-2"><Skeleton className="h-4 w-10 mx-auto" /></td>
                          <td className="py-3 px-2"><Skeleton className="h-8 w-24 mx-auto rounded" /></td>
                          <td className="py-3 px-2"><Skeleton className="h-4 w-12 mx-auto" /></td>
                          <td className="py-3 px-2"><Skeleton className="h-4 w-40" /></td>
                          <td className="py-3 px-2"><Skeleton className="h-6 w-20 mx-auto rounded-full" /></td>
                          {canWrite && <td className="py-3 px-2"><Skeleton className="h-7 w-16 mx-auto rounded" /></td>}
                          <td className="py-3 px-3"><Skeleton className="h-4 w-10 ml-auto" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {fetchError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
                日報の取得に失敗しました: {fetchError}
              </div>
            )}
            {approveWarnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">承認しましたが、車両の走行距離について注意があります：</p>
                  {approveWarnings.map((w, i) => (
                    <p key={i}>・{w}</p>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setApproveWarnings([])}
                  className="shrink-0 text-amber-600 hover:text-amber-800 text-xs"
                >
                  閉じる
                </button>
              </div>
            )}

            {tab === "pending" ? (
              (() => {
                type Status = "off" | "unsubmitted" | "pending" | "approved";
                const filteredSummaries = daySummaries
                  .filter((s) => s.date <= businessToday)
                  .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

                // ドライバー×日付の状態を算出。1日複数コース対応のため「担当コードに対し
                // 未提出のコースが1つでもあれば代理入力が必要(needsProxy)」として扱う。
                const computeDriverRow = (s: DaySummary, driver: DaySummary["drivers"][number]) => {
                  const shiftCourses = s.shiftCoursesByDriver?.[driver.id] ?? [];
                  const hasShift = shiftCourses.length > 0 || s.shiftDriverIds.includes(driver.id);
                  const reps = s.reportsByDriver[driver.id] ?? []; // API側で却下分は除外済み
                  const reportedCourseIds = new Set(
                    reps.map((r) => r.course_id).filter((c): c is string => !!c),
                  );
                  const missingCount = hasShift
                    ? shiftCourses.filter((c) => !reportedCourseIds.has(c)).length
                    : 0;
                  const hasUnapproved = reps.some((r) => !r.approved_at);
                  let status: Status;
                  if (!hasShift) status = "off";
                  else if (reps.length === 0) status = "unsubmitted";
                  else if (hasUnapproved) status = "pending";
                  else status = "approved";
                  // 全コース未提出(unsubmitted) または 一部コースだけ未提出 → 代理入力が必要
                  const needsProxy = hasShift && (status === "unsubmitted" || missingCount > 0);
                  const actionable = needsProxy || hasUnapproved;
                  return { driver, reps, status, needsProxy, actionable };
                };

                const withActionable = filteredSummaries.map((s) => {
                  const actionable = s.drivers.filter((d) => computeDriverRow(s, d).actionable).length;
                  return { summary: s, actionable };
                });

                const actionableSummaries = withActionable.filter((x) => x.actionable > 0);
                const totalActionable = actionableSummaries.reduce((acc, x) => acc + x.actionable, 0);
                const maxDrivers =
                  actionableSummaries.length > 0
                    ? Math.max(...actionableSummaries.map((x) => x.summary.drivers.length))
                    : 0;

                const renderDayTable = (summary: DaySummary, actionableCount: number) => {
                  const baseRows = summary.drivers
                    // 稼働終了で、その日シフトも日報も無い人は出さない
                    // （在籍中は休みでも表示。退職者でも実績があれば残る）。
                    .filter(
                      (driver) =>
                        driver.status === "active" ||
                        summary.shiftDriverIds.includes(driver.id) ||
                        (summary.reportsByDriver[driver.id] ?? []).length > 0,
                    )
                    .map((driver) => computeDriverRow(summary, driver));
                  const isToday = summary.date === businessToday;
                  const rows = isToday ? baseRows : baseRows.filter((r) => r.actionable);
                  return (
                    <div key={summary.date} className="mb-8">
                      <h2 className="text-sm font-semibold text-slate-800 mb-2">
                        {(() => {
                          const [y, m, d] = summary.date.split("-");
                          return (
                            <>
                              <span className="text-slate-900 text-base">{y}</span>
                              <span className="text-slate-500 text-xs pl-0.5 pr-1">年</span>
                              <span className="text-slate-900 text-base">{parseInt(m, 10)}</span>
                              <span className="text-slate-500 text-xs pl-0.5 pr-1">月</span>
                              <span className="text-slate-900 text-base">{parseInt(d, 10)}</span>
                              <span className="text-slate-500 text-xs pl-0.5 pr-1">日</span>
                              <span className="text-slate-500 text-xs"> ({actionableCount} 件要対応)</span>
                            </>
                          );
                        })()}
                      </h2>
                      {rows.length > 0 && (
                        <>
                        {/* スマホ: カード表示 */}
                        <div className="md:hidden space-y-2">
                          {rows.map(({ driver, reps, status, needsProxy }) => {
                            const driverEntry: Entry = {
                              driver: { id: driver.id, name: driver.name, display_name: driver.display_name },
                              report: { report_date: summary.date, takuhaibin_completed: 0, takuhaibin_returned: 0, nekopos_completed: 0, nekopos_returned: 0, submitted_at: "", carrier: "YAMATO" } as ReportData,
                            };
                            return (
                              <PendingDriverCard
                                key={`card-${driver.id}-${summary.date}`}
                                driver={driver}
                                reps={reps}
                                status={status}
                                needsProxy={needsProxy}
                                canWrite={canWrite}
                                onApprove={() => handleApprove(driverEntry, summary.date)}
                                onReject={() => handleReject(driverEntry, summary.date)}
                                onEdit={(r) => openEdit({
                                  driver: { id: driver.id, name: driver.name, display_name: driver.display_name },
                                  report: { ...(r as unknown as ReportData), id: r.id },
                                })}
                                onProxyEntry={() => openProxy(driver, summary.date)}
                              />
                            );
                          })}
                        </div>
                        {/* PC: テーブル表示 */}
                        <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
                          <div className="overflow-x-auto table-scroll table-scroll-fade -mx-1 md:mx-0">
                            <table className="w-full text-sm table-fixed min-w-[860px] md:min-w-0">
                            <colgroup>
                              <col className="w-28" />
                              <col className="w-20" />
                              <col className="w-40" />
                              <col className="w-24" />
                              <col className="w-auto" />
                              <col className="w-36" />
                              {canWrite && <col className="w-24" />}
                              <col className="w-24" />
                            </colgroup>
                            <thead className="bg-slate-50">
                              <tr className="border-b border-slate-200 text-left">
                                <th className="py-3 px-3 font-semibold text-slate-600">名前</th>
                                <th className="py-3 px-2 font-semibold text-slate-600 text-center">種別</th>
                                <th className="py-3 px-2 font-semibold text-slate-600 text-center">車両</th>
                                <th className="py-3 px-2 font-semibold text-slate-600 text-center">メーター</th>
                                <th className="py-3 px-2 font-semibold text-slate-600 text-center">内容</th>
                                <th className="py-3 px-2 font-semibold text-slate-600 text-center">承認</th>
                                {canWrite && <th className="py-3 px-2 font-semibold text-slate-600 text-center">操作</th>}
                                <th className="py-3 px-3 font-semibold text-slate-600 text-right">送信時刻</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(({ driver, reps, status, needsProxy }) => {
                                // 提出済み分は承認済みでも、他コースが未提出のままなら「対応済み」表示にしない
                                const isResolved = status === "approved" && !needsProxy;
                                const isGray = status === "off" || isResolved;
                                const stack = reps.length > 1;
                                const stackCls = stack ? "flex flex-col gap-2 items-center" : "";
                                const driverEntry: Entry = {
                                  driver: { id: driver.id, name: driver.name, display_name: driver.display_name },
                                  report: { report_date: summary.date, takuhaibin_completed: 0, takuhaibin_returned: 0, nekopos_completed: 0, nekopos_returned: 0, submitted_at: "", carrier: "YAMATO" } as ReportData,
                                };
                                const repEntry = (r: DaySummaryReport): Entry => ({
                                  driver: { id: driver.id, name: driver.name, display_name: driver.display_name },
                                  report: { ...(r as unknown as ReportData), id: r.id },
                                });
                                const dash = <span className="inline-block w-full text-center text-slate-400 text-xs">—</span>;
                                const carrierBadge = (r: DaySummaryReport) => (
                                  <span className="flex flex-col items-center gap-0.5 w-full min-w-0">
                                    <span
                                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${carrierBadgeTone(r.carrier, r.carrier_name, isGray)}`}
                                    >
                                      {carrierBadgeLabel(r.carrier, r.carrier_name)}
                                    </span>
                                    {r.course_name && <span className="block w-full truncate text-[10px] text-slate-500" title={r.course_name}>{r.course_name}</span>}
                                  </span>
                                );
                                const reportContent = (r: DaySummaryReport) => (
                                  <ReportContentView units={r.content} muted={isGray} />
                                );
                                return (
                                  <tr key={`${driver.id}-${summary.date}`} className={`border-b border-slate-100 ${isGray ? "bg-slate-100 text-slate-500" : "hover:bg-slate-50"}`}>
                                    <td className="py-3 px-3 font-medium align-middle">{getDisplayName(driver)}</td>
                                    <td className="py-3 px-2 text-center align-middle">
                                      {reps.length === 0 ? dash : <div className={stackCls}>{reps.map((r) => <span key={r.id}>{carrierBadge(r)}</span>)}</div>}
                                    </td>
                                    <td className="py-2 px-2 align-middle text-center">
                                      {reps.length === 0 ? dash : (
                                        <div className={stackCls}>
                                          {reps.map((r) =>
                                            r.vehicle_plate && (r.vehicle_plate.number_prefix || r.vehicle_plate.number_hiragana || r.vehicle_plate.number_numeric) ? (
                                              <VehiclePlate key={r.id} vehicle={r.vehicle_plate} compact className="max-w-[150px] mx-auto" />
                                            ) : (
                                              <span key={r.id} className="text-xs text-slate-400">—</span>
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-3 px-2 text-center text-xs tabular-nums align-middle">
                                      {reps.length === 0 ? dash : (
                                        <div className={stackCls}>
                                          {reps.map((r) =>
                                            r.meter_value != null ? (
                                              <span key={r.id} className="tabular-nums">{r.meter_value.toLocaleString()}<span className="text-[10px] text-slate-500 ml-1">km</span></span>
                                            ) : (
                                              <span key={r.id} className="text-slate-400 text-xs">—</span>
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-3 px-2 text-left align-middle">
                                      {status === "unsubmitted" && <span className="text-red-600 align-middle font-semibold">日報が未提出です</span>}
                                      {status === "off" && reps.length === 0 && <span className="text-slate-500 align-middle">休み</span>}
                                      {reps.length > 0 && (
                                        <div className={stack ? "flex flex-col gap-2" : ""}>
                                          {reps.map((r) => <div key={r.id}>{reportContent(r)}</div>)}
                                        </div>
                                      )}
                                      {needsProxy && reps.length > 0 && (
                                        <span className="block mt-1 text-[11px] font-semibold text-red-600">未提出のコースがあります</span>
                                      )}
                                    </td>
                                    <td className="py-3 px-2 text-center align-middle">
                                      {isResolved && <span className="inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700"><FontAwesomeIcon icon={faCircleCheck} className="mr-1" />承認済み</span>}
                                      {status === "approved" && needsProxy && <span className="inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">一部未提出</span>}
                                      {status === "pending" && canWrite && (
                                        <div className="flex items-center justify-center gap-2">
                                          <button type="button" onClick={() => handleApprove(driverEntry, summary.date)} className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-800 text-white hover:bg-slate-700">承認</button>
                                          <button type="button" onClick={() => handleReject(driverEntry, summary.date)} className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">却下</button>
                                        </div>
                                      )}
                                      {status === "pending" && !canWrite && <span className="text-slate-400 text-xs">未承認</span>}
                                      {status === "unsubmitted" && <span className="text-slate-400 text-xs">—</span>}
                                      {status === "off" && <span className="text-slate-400 text-xs">—</span>}
                                    </td>
                                    {canWrite && (
                                      <td className="py-3 px-2 text-center align-middle">
                                        <div className="flex flex-col items-center gap-1.5">
                                          {(status === "pending" || status === "approved") && reps.length > 0 && (
                                            <div className={stackCls}>
                                              {reps.map((r) => (
                                                <button key={r.id} type="button" onClick={() => openEdit(repEntry(r))} className="text-sm text-slate-600 hover:text-slate-900 underline">
                                                  <FontAwesomeIcon icon={faPenToSquare} />
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                          {needsProxy && (
                                            <button
                                              type="button"
                                              onClick={() => openProxy(driver, summary.date)}
                                              className="inline-flex items-center whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                                            >
                                              代理入力
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    )}
                                    <td className="py-3 px-3 text-right text-xs text-slate-400 align-middle">
                                      {reps.length === 0 ? "—" : (
                                        <div className={stack ? "flex flex-col gap-2 items-end" : ""}>
                                          {reps.map((r) => <span key={r.id} className="tabular-nums">{r.submitted_at ? new Date(r.submitted_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>)}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            </table>
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
                      <div className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                        <div className="text-xl md:text-2xl font-bold text-slate-900">{totalActionable}</div>
                        <div className="text-xs text-slate-500 mt-0.5">要対応（未提出・未承認）</div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                        <div className="text-xl md:text-2xl font-bold text-slate-900">{maxDrivers}</div>
                        <div className="text-xs text-slate-500 mt-0.5">ドライバー数（最大）</div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                        <div className="text-xl md:text-2xl font-bold text-slate-900">{actionableSummaries.length}</div>
                        <div className="text-xs text-slate-500 mt-0.5">対象日数</div>
                      </div>
                    </div>
                    {!fetchError && actionableSummaries.length === 0 && (
                      <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
                        要対応の日報はありません。
                      </div>
                    )}
                    {!fetchError &&
                      actionableSummaries.map(({ summary, actionable }) =>
                        renderDayTable(summary, actionable)
                      )}
                  </>
                );
              })()
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
                  <div className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                    <div className="text-xl md:text-2xl font-bold text-slate-900">{totalEntries}</div>
                    <div className="text-xs text-slate-500 mt-0.5">全件数</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                    <div className="text-xl md:text-2xl font-bold text-slate-900">{groups.length}</div>
                    <div className="text-xs text-slate-500 mt-0.5">対象日数</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-3 md:p-4">
                    <div className="text-xl md:text-2xl font-bold text-slate-900">
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
                    {/* スマホ: カード表示 */}
                    <div className="md:hidden space-y-2">
                      {group.entries.map((e) => (
                        <AllReportCard
                          key={`card-${e.driver.id}-${group.date}-${e.report.id ?? ""}`}
                          driver={e.driver}
                          report={e.report}
                          approved={isApproved(e.report)}
                          rejected={isRejected(e.report)}
                          canWrite={canWrite}
                          showEdit={tab === "all"}
                          onApprove={() => handleApprove(e, group.date)}
                          onReject={() => handleReject(e, group.date)}
                          onEdit={() => openEdit(e)}
                        />
                      ))}
                    </div>
                    {/* PC: テーブル表示 */}
                    <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
                      <div className="overflow-x-auto table-scroll table-scroll-fade -mx-1 md:mx-0">
                        <table className="w-full text-sm table-fixed min-w-[720px] md:min-w-0">
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
                                  <div className="flex flex-col items-center gap-0.5 w-full min-w-0">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${carrierBadgeTone(carrier, r.carrier_name)}`}
                                    >
                                      {carrierBadgeLabel(carrier, r.carrier_name)}
                                    </span>
                                    {r.course_name && <span className="block w-full truncate text-[10px] text-slate-500" title={r.course_name}>{r.course_name}</span>}
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-left align-middle">
                                  <div className="pl-6">
                                    <ReportContentView units={r.content} />
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-center align-middle">
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
                                        className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-800 text-white hover:bg-slate-700"
                                      >
                                        承認
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleReject(e, group.date)}
                                        className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
                                      >
                                        却下
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 text-xs">未承認</span>
                                  )}
                                </td>
                                {tab === "all" && canWrite && (
                                  <td className="py-3 px-3 text-center align-middle">
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
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* 編集モーダル（遅延読み込み） */}
      {editingEntry && (
        <EditReportModal
          editingEntry={editingEntry}
          editForm={editForm}
          setEditForm={(updater) => setEditForm((prev) => updater(prev))}
          savingEdit={savingEdit}
          saveError={editSaveError}
          onClose={() => {
            setEditSaveError(null);
            setEditingEntry(null);
          }}
          onSave={saveEdit}
        />
      )}

      {/* 代理入力モーダル（遅延読み込み） */}
      {proxyTarget && (
        <ProxyReportModal
          target={proxyTarget}
          onClose={() => setProxyTarget(null)}
          onSaved={() => {
            setProxyTarget(null);
            load("pending");
          }}
        />
      )}
      </>
      )}
    </AdminLayout>
  );
}
