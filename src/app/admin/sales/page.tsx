"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowTrendUp, faArrowTrendDown, faAngleDown } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { DateRangePicker, type DateRangeValue } from "@/lib/components/DateRangePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/ui/popover";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type DataPoint = { date: string; yamato: number; amazon: number; profit: number };
type DriverRow = { id: string; name: string; display_name?: string | null };
type CourseRow = { id: string; name: string };
type ReportRow = {
  driver_id: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
};

type MidnightRow = {
  driver_id: string;
  date: string;
};

type Tab = "analytics" | "summary" | "log";
type CarrierFilter = "ALL" | "YAMATO" | "AMAZON";

type SalesLogEntry = {
  log_date: string;
  driver_payment: number;
  vehicle_repair: number;
  oil_change: number;
  one_off_amount: number;
  one_off_memo: string | null;
};

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-4 py-3 text-sm">
      <p className="font-medium text-slate-900 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-slate-600">{entry.name}</span>
          <span className="ml-auto font-medium text-slate-900 pl-4">
            {fmt(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function SalesPage() {
  const [tab, setTab] = useState<Tab>("analytics");
  const [range, setRange] = useState<DateRangeValue | undefined>();
  const [deliveryData, setDeliveryData] = useState<DataPoint[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [midnights, setMidnights] = useState<MidnightRow[]>([]);
  const [prevTotals, setPrevTotals] = useState<{ total: number; profit: number } | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [carrierFilter, setCarrierFilter] = useState<CarrierFilter>("ALL");
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const masterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [logEntries, setLogEntries] = useState<SalesLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [logSaving, setLogSaving] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  useEffect(() => {
    if (masterCheckboxRef.current && courses.length > 0) {
      masterCheckboxRef.current.indeterminate =
        selectedCourseIds.size > 0 && selectedCourseIds.size < courses.length;
    }
  }, [selectedCourseIds, courses.length]);

  // コース一覧を取得
  useEffect(() => {
    apiFetch<{ courses: CourseRow[] }>("/api/admin/courses")
      .then((res) => setCourses(res.courses ?? []))
      .catch(() => setCourses([]));
  }, []);

  const courseIdsQuery =
    selectedCourseIds.size > 0
      ? `&course_ids=${Array.from(selectedCourseIds).join(",")}`
      : "";

  // URL のクエリ (?tab=summary など) から初期タブを決定（クライアント側でのみ実行）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "summary") setTab("summary");
    else if (t === "log") setTab("log");
  }, []);

  const startIso = useMemo(
    () => (range?.startDate ? toLocalYmd(range.startDate) : ""),
    [range?.startDate],
  );
  const endIso = useMemo(
    () => (range?.endDate ? toLocalYmd(range.endDate) : ""),
    [range?.endDate],
  );

  // 前期間（同じ日数分ひとつ前の区間）の売上・利益を取得
  useEffect(() => {
    if (!startIso || !endIso) return;
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return;
    }
    const days =
      Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      ) || 1;

    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));

    const prevStartIso = toLocalYmd(prevStart);
    const prevEndIso = toLocalYmd(prevEnd);

    setLoadingPrev(true);
    apiFetch<{ data: DataPoint[] }>(
      `/api/admin/sales?start=${prevStartIso}&end=${prevEndIso}${courseIdsQuery}`,
    )
      .then((res) => {
        const data = res.data ?? [];
        const yamato = data.reduce((s, d) => s + d.yamato, 0);
        const amazon = data.reduce((s, d) => s + d.amazon, 0);
        const profit = data.reduce((s, d) => s + d.profit, 0);
        setPrevTotals({ total: yamato + amazon, profit });
      })
      .catch(() => setPrevTotals(null))
      .finally(() => setLoadingPrev(false));
  }, [startIso, endIso, courseIdsQuery]);

  useEffect(() => {
    if (!startIso || !endIso) return;
    setLoadingAnalytics(true);
    apiFetch<{ data: DataPoint[] }>(
      `/api/admin/sales?start=${startIso}&end=${endIso}${courseIdsQuery}`,
    )
      .then((res) => setDeliveryData(res.data ?? []))
      .catch(() => setDeliveryData([]))
      .finally(() => setLoadingAnalytics(false));
  }, [startIso, endIso, courseIdsQuery]);

  useEffect(() => {
    if (tab !== "summary" || !startIso || !endIso) return;
    setLoadingSummary(true);
    apiFetch<{
      drivers: DriverRow[];
      reports: ReportRow[];
      midnights: MidnightRow[];
    }>(`/api/admin/sales/reports?start=${startIso}&end=${endIso}`)
      .then((res) => {
        setDrivers(res.drivers ?? []);
        setReports(res.reports ?? []);
        setMidnights(res.midnights ?? []);
      })
      .catch(() => {
        setDrivers([]);
        setReports([]);
        setMidnights([]);
      })
      .finally(() => setLoadingSummary(false));
  }, [startIso, endIso, tab]);

  useEffect(() => {
    if (tab !== "log" || !startIso || !endIso) return;
    setLoadingLog(true);
    apiFetch<{ entries: SalesLogEntry[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
      .then((res) => setLogEntries(res.entries ?? []))
      .catch(() => setLogEntries([]))
      .finally(() => setLoadingLog(false));
  }, [tab, startIso, endIso]);

  const displayData = useMemo(() => {
    if (carrierFilter === "ALL") return deliveryData;
    return deliveryData.map((d) =>
      carrierFilter === "YAMATO"
        ? { ...d, amazon: 0 }
        : { ...d, yamato: 0 },
    );
  }, [deliveryData, carrierFilter]);

  // 数値に応じた「きりの良い」上限（例: 15万→20万、23万→25万、38万→50万）
  const niceCeil = (value: number): number => {
    if (value <= 0) return 50000;
    const mag = 10 ** Math.floor(Math.log10(value));
    const n = value / mag;
    if (n <= 1) return mag * 1;
    if (n <= 2) return mag * 2;
    if (n <= 2.5) return mag * 2.5;
    if (n <= 5) return mag * 5;
    return mag * 10;
  };

  // グラフ縦軸用: 売上・利益の最大値に合わせた動的domain（きりの良い上限）
  const yAxisDomain = useMemo(() => {
    if (!displayData.length) return { left: [0, 100000] as [number, number], right: [0, 100000] as [number, number] };
    let maxRevenue = 0;
    let maxProfit = 0;
    for (const d of displayData) {
      const rev = d.yamato + d.amazon;
      if (rev > maxRevenue) maxRevenue = rev;
      if (d.profit > maxProfit) maxProfit = d.profit;
    }
    return {
      left: [0, niceCeil(Math.max(maxRevenue, 1))] as [number, number],
      right: [0, niceCeil(Math.max(maxProfit, 1))] as [number, number],
    };
  }, [displayData]);

  // 縦軸ラベル: 1万以上は「○万」、未満はそのまま（M表記は使わない）
  const yAxisTickFormatter = (v: number) =>
    v >= 10000 ? `${v / 10000}万` : v.toLocaleString("ja-JP");

  const daysInRange = useMemo(() => {
    if (!startIso || !endIso) return [];
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return [];
    }
    const list: { iso: string; label: string }[] = [];
    const d = new Date(start);
    while (d <= end) {
      const iso = toLocalYmd(d);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      list.push({ iso, label });
      d.setDate(d.getDate() + 1);
    }
    return list;
  }, [startIso, endIso]);

  const reportMap = useMemo(() => {
    const map = new Map<string, ReportRow>();
    (reports ?? []).forEach((r) => map.set(`${r.driver_id}:${r.report_date}`, r));
    return map;
  }, [reports]);

  const driverTotals = useMemo(() => {
    const totalsByDriver = new Map<string, { tk: number; nk: number; total: number }>();
    (drivers ?? []).forEach((d) => totalsByDriver.set(d.id, { tk: 0, nk: 0, total: 0 }));
    (reports ?? []).forEach((r) => {
      const t = totalsByDriver.get(r.driver_id) ?? { tk: 0, nk: 0, total: 0 };
      const tk = r.takuhaibin_completed ?? 0;
      const nk = r.nekopos_completed ?? 0;
      t.tk += tk;
      t.nk += nk;
      t.total += tk + nk;
      totalsByDriver.set(r.driver_id, t);
    });
    return totalsByDriver;
  }, [drivers, reports]);

  const midnightSet = useMemo(() => {
    const s = new Set<string>();
    (midnights ?? []).forEach((m) => {
      s.add(`${m.driver_id}:${m.date}`);
    });
    return s;
  }, [midnights]);

  const midnightCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (midnights ?? []).forEach((m) => {
      counts.set(m.driver_id, (counts.get(m.driver_id) ?? 0) + 1);
    });
    return counts;
  }, [midnights]);

  const totals = useMemo(() => {
    const yamato = displayData.reduce((s, d) => s + d.yamato, 0);
    const amazon = displayData.reduce((s, d) => s + d.amazon, 0);
    const profit = displayData.reduce((s, d) => s + d.profit, 0);
    return { yamato, amazon, total: yamato + amazon, profit };
  }, [displayData]);

  const dailyAvg = useMemo(() => {
    const len = displayData.length || 1;
    return {
      revenue: Math.round(totals.total / len),
      profit: Math.round(totals.profit / len),
    };
  }, [totals, displayData.length]);

  const daysCount = daysInRange.length || 1;
  const activeDays = useMemo(
    () => displayData.filter((d) => d.yamato + d.amazon > 0).length,
    [displayData],
  );
  const activeDriverCount = useMemo(() => {
    let count = 0;
    drivers.forEach((drv) => {
      const t = driverTotals.get(drv.id);
      const mid = midnightCounts.get(drv.id) ?? 0;
      if ((t && t.total > 0) || mid > 0) count += 1;
    });
    return count || 1;
  }, [drivers, driverTotals, midnightCounts]);

  const margin = totals.total ? (totals.profit / totals.total) * 100 : null;
  const prevMargin =
    prevTotals && prevTotals.total
      ? (prevTotals.profit / prevTotals.total) * 100
      : null;

  const revenuePerDay = totals.total / daysCount;
  const revenuePerDriver = totals.total / activeDriverCount;
  const utilization =
    daysCount > 0 ? ((activeDays / daysCount) * 100) : 0;

  const revenueChangePct =
    prevTotals && prevTotals.total
      ? ((totals.total - prevTotals.total) / prevTotals.total) * 100
      : null;
  const marginDiff =
    margin != null && prevMargin != null ? margin - prevMargin : null;

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">売上</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 w-fit mb-4">
          <button
            onClick={() => setTab("analytics")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "analytics" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
          >
            アナリティクス
          </button>
          <button
            onClick={() => setTab("summary")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "summary" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
          >
            集計
          </button>
          <button
            onClick={() => setTab("log")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "log" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
          >
            ログ
          </button>
        </div>

        {/* 日付範囲選択 + キャリア・コースフィルタ（アナリティクス / 集計 共通） */}
        <div className="flex flex-col gap-4 mb-6">
          <DateRangePicker value={range} onChange={setRange} />
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">対象キャリア</span>
              <div className="inline-flex rounded-full bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setCarrierFilter("ALL")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${carrierFilter === "ALL"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                    }`}
                >
                  全体
                </button>
                <button
                  type="button"
                  onClick={() => setCarrierFilter("YAMATO")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${carrierFilter === "YAMATO"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                    }`}
                >
                  ヤマト
                </button>
                <button
                  type="button"
                  onClick={() => setCarrierFilter("AMAZON")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${carrierFilter === "AMAZON"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                    }`}
                >
                  Amazon
                </button>
              </div>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <span>対象コース</span>
                  <FontAwesomeIcon icon={faAngleDown} className="w-3.5 h-3.5" />
                  {selectedCourseIds.size > 0 && (
                    <span className="ml-0.5 text-slate-900">({selectedCourseIds.size})</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="start">
                {courses.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">読み込み中...</p>
                ) : (
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 py-1.5 border-b border-slate-100">
                      <input
                        ref={masterCheckboxRef}
                        type="checkbox"
                        checked={courses.length > 0 && selectedCourseIds.size === courses.length}
                        onChange={() => {
                          if (selectedCourseIds.size === courses.length) {
                            setSelectedCourseIds(new Set());
                          } else {
                            setSelectedCourseIds(new Set(courses.map((c) => c.id)));
                          }
                        }}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                      すべて
                    </label>
                    {courses.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 hover:text-slate-900 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCourseIds.has(c.id)}
                          onChange={() => {
                            setSelectedCourseIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-start gap-6">
          <div className="flex-1 min-w-0">
            {tab === "analytics" && (
              <>
                {loadingAnalytics ? (
                  <div className="bg-white rounded-lg border border-slate-200 p-6">
                    <Skeleton className="h-[420px] w-full" />
                  </div>
                ) : displayData.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8">該当データがありません</p>
                ) : (
                  <>
                    {/* チャート: 縦軸はデータに合わせて動的、縦方向は画面いっぱい */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6 w-full" style={{ height: "clamp(420px, 65vh, 85vh)" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={displayData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                          <YAxis yAxisId="left" domain={yAxisDomain.left} tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={yAxisTickFormatter} width={48} />
                          <YAxis yAxisId="right" domain={yAxisDomain.right} orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={yAxisTickFormatter} width={48} />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend wrapperStyle={{ paddingTop: "16px", fontSize: "12px" }} iconType="square" iconSize={10} />
                          <Bar yAxisId="left" dataKey="yamato" stackId="revenue" fill="#334155" name="ヤマト売上" radius={[0, 0, 0, 0]} />
                          <Bar yAxisId="left" dataKey="amazon" stackId="revenue" fill="#94a3b8" name="Amazon売上" radius={[3, 3, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="profit" stroke="#059669" strokeWidth={2.5} name="利益" dot={{ fill: "#059669", r: 3, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "summary" && (
              <>
                <div className="text-sm text-slate-600 mb-3">
                  <span className="font-medium">daily_reports</span> の内容を月次で確認します（ヤマト個数: 宅急便/ネコポス）。
                </div>

                {loadingSummary ? (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-auto">
                      <table className="min-w-max text-xs w-full">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-3 py-2 text-left w-24"><Skeleton className="h-4 w-20" /></th>
                            <th className="px-2 py-2 w-8" />
                            {[...Array(14)].map((_, i) => (
                              <th key={i} className="px-2 py-2 min-w-[64px]"><Skeleton className="h-4 w-10 mx-auto" /></th>
                            ))}
                            <th className="px-3 py-2 text-right w-24"><Skeleton className="h-4 w-14 ml-auto" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...Array(10)].map((_, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-3 py-2"><Skeleton className="h-4 w-16" /></td>
                              <td className="px-2 py-2 w-8" />
                              {[...Array(14)].map((_, j) => (
                                <td key={j} className="px-2 py-2"><Skeleton className="h-5 w-8 mx-auto" /></td>
                              ))}
                              <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : drivers.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8">ドライバーがいません</p>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-auto">
                      <table className="min-w-max text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="sticky left-0 z-20 bg-slate-50 border-b border-slate-200 px-3 py-2 text-left min-w-[100px]">
                              ドライバー
                            </th>
                            <th className="sticky left-[100px] z-10 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-right min-w-[27px]"></th>
                            {daysInRange.map((d) => (
                              <th key={d.iso} className="border-b border-slate-200 px-2 py-2 text-center min-w-[64px]">
                                {d.label}
                              </th>
                            ))}
                            <th className="sticky right-0 z-20 bg-slate-50 border-b border-l border-slate-200 px-3 py-2 text-right min-w-[96px]">
                              <div className="text-right">
                                <div>月計</div>
                                <div className="text-[10px] text-slate-400">ミッド</div>
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {drivers.map((drv) => {
                            const t = driverTotals.get(drv.id) ?? { tk: 0, nk: 0, total: 0 };
                            const midDays = midnightCounts.get(drv.id) ?? 0;
                            return (
                              <tr key={drv.id} className="border-t border-slate-100">
                                <td className="sticky left-0 z-10 bg-white border-r border-slate-100 px-3 py-2 text-left">
                                  <div className="font-medium text-slate-900">{drv.display_name ?? drv.name}</div>
                                </td>
                                <td className="sticky left-[100px] z-10 bg-white border-r border-slate-100 px-3 py-2 text-right">
                                  <div className="text-[10px] text-slate-400">宅</div>
                                  <div className="text-[10px] text-slate-400">ネ</div>
                                </td>
                                {daysInRange.map((d) => {
                                  const key = `${drv.id}:${d.iso}`;
                                  const isMidnight = midnightSet.has(key);
                                  const r = reportMap.get(key);
                                  const tk = r?.takuhaibin_completed ?? 0;
                                  const nk = r?.nekopos_completed ?? 0;
                                  const tkRet = r?.takuhaibin_returned ?? 0;
                                  const nkRet = r?.nekopos_returned ?? 0;
                                  const has = tk + nk > 0 || isMidnight;
                                  return (
                                    <td
                                      key={d.iso}
                                      className={`px-2 py-2 text-center ${has ? "text-slate-900" : "text-slate-300"}`}
                                      title={
                                        isMidnight
                                          ? "Amazonミッドナイト"
                                          : `宅急便 配完 ${tk} / 持戻 ${tkRet}\nネコポス 配完 ${nk} / 持戻 ${nkRet}`
                                      }
                                    >
                                      {isMidnight ? (
                                        <div className="text-[11px] font-semibold text-indigo-600">ミッド</div>
                                      ) : (
                                        <>
                                          <div className="tabular-nums text-[11px] font-semibold">{tk || "·"}</div>
                                          <div className="tabular-nums text-[11px] font-semibold">{nk || "·"}</div>
                                        </>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="sticky right-0 z-10 bg-white border-l border-slate-100 px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-3">
                                    <div className="text-right">
                                      <div className="tabular-nums font-semibold text-slate-900">
                                        {t.tk}
                                      </div>
                                      <div className="tabular-nums font-semibold text-slate-900 mt-0.5">
                                        {t.nk}
                                      </div>
                                    </div>
                                    <div className="w-10 text-[10px] font-semibold text-slate-900 whitespace-nowrap">
                                      {midDays}日
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === "log" && (
              <>
                <div className="text-sm text-slate-600 mb-3">
                  日付ごとの売上（ヤマト・Amazon）と、ドライバー支払い・車両費・単発案件を記入できます。編集後はセルを離れると自動保存されます。
                </div>
                {loadingLog ? (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden p-6">
                    <Skeleton className="h-8 w-full mb-4" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-max text-xs w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap">日付</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">ヤマト売上</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">Amazon売上</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">ドライバー支払い</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">車両修理費</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">オイル交換代</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">単発案件(円)</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[140px]">単発案件(メモ)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {daysInRange.map((day, i) => {
                            const sales = displayData[i];
                            const yamato = sales?.yamato ?? 0;
                            const amazon = sales?.amazon ?? 0;
                            const entry = logEntries.find((e) => e.log_date === day.iso) ?? {
                              log_date: day.iso,
                              driver_payment: 0,
                              vehicle_repair: 0,
                              oil_change: 0,
                              one_off_amount: 0,
                              one_off_memo: null,
                            };
                            const saving = logSaving === day.iso;
                            const saveLog = (updates: Partial<SalesLogEntry>) => {
                              if (!canWrite) return;
                              setLogSaving(day.iso);
                              const next = { ...entry, ...updates };
                              apiFetch("/api/admin/sales/log", {
                                method: "PATCH",
                                body: JSON.stringify({ entries: [next] }),
                              })
                                .then(() => {
                                  setLogEntries((prev) => {
                                    const idx = prev.findIndex((e) => e.log_date === day.iso);
                                    const nextEntry = { ...entry, ...updates };
                                    if (idx >= 0) {
                                      const p = [...prev];
                                      p[idx] = nextEntry;
                                      return p;
                                    }
                                    return [...prev, nextEntry].sort((a, b) => a.log_date.localeCompare(b.log_date));
                                  });
                                })
                                .catch(() => {})
                                .finally(() => setLogSaving(null));
                            };
                            return (
                              <tr key={day.iso} className="border-t border-slate-100 hover:bg-slate-50/50">
                                <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">{day.label}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(yamato)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(amazon)}</td>
                                <td className="px-3 py-2">
                                  {canWrite ? (
                                    <input
                                      type="number"
                                      defaultValue={entry.driver_payment}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        if (v !== entry.driver_payment) saveLog({ driver_payment: v });
                                      }}
                                      className="w-full min-w-[72px] px-2 py-1 text-right border border-slate-200 rounded tabular-nums focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                      placeholder="0"
                                    />
                                  ) : (
                                    <span className="text-right tabular-nums text-slate-700 block">{fmt(entry.driver_payment)}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {canWrite ? (
                                    <input
                                      type="number"
                                      defaultValue={entry.vehicle_repair}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        if (v !== entry.vehicle_repair) saveLog({ vehicle_repair: v });
                                      }}
                                      className="w-full min-w-[72px] px-2 py-1 text-right border border-slate-200 rounded tabular-nums focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                      placeholder="0"
                                    />
                                  ) : (
                                    <span className="text-right tabular-nums text-slate-700 block">{fmt(entry.vehicle_repair)}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {canWrite ? (
                                    <input
                                      type="number"
                                      defaultValue={entry.oil_change}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        if (v !== entry.oil_change) saveLog({ oil_change: v });
                                      }}
                                      className="w-full min-w-[72px] px-2 py-1 text-right border border-slate-200 rounded tabular-nums focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                      placeholder="0"
                                    />
                                  ) : (
                                    <span className="text-right tabular-nums text-slate-700 block">{fmt(entry.oil_change)}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {canWrite ? (
                                    <input
                                      type="number"
                                      defaultValue={entry.one_off_amount || ""}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        if (v !== entry.one_off_amount) saveLog({ one_off_amount: v });
                                      }}
                                      className="w-full min-w-[72px] px-2 py-1 text-right border border-slate-200 rounded tabular-nums focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                      placeholder="0"
                                    />
                                  ) : (
                                    <span className="text-right tabular-nums text-slate-700 block">{fmt(entry.one_off_amount)}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {canWrite ? (
                                    <input
                                      type="text"
                                      defaultValue={entry.one_off_memo ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim() || null;
                                        if (v !== (entry.one_off_memo ?? "")) saveLog({ one_off_memo: v });
                                      }}
                                      className="w-full min-w-[120px] px-2 py-1 border border-slate-200 rounded focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                      placeholder="メモ"
                                    />
                                  ) : (
                                    <span className="text-slate-700 block">{entry.one_off_memo ?? "–"}</span>
                                  )}
                                  {saving && <span className="ml-1 text-slate-400 text-[10px]">保存中...</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 右パネル: 分析サマリー */}
          <div className="w-full lg:w-80 space-y-4">
            {loadingAnalytics ? (
              <>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-3 w-14 mb-2" />
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <Skeleton className="h-4 flex-1 max-w-[100px]" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-3 w-12 mb-2" />
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <Skeleton className="h-4 flex-1 max-w-[120px]" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-3 w-16 mb-2" />
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <Skeleton className="h-4 flex-1 max-w-[100px]" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 売上カード: 売上を大きく、前期間比は近くに小さく */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500 mb-1">売上</div>
                  <div className="text-2xl font-bold text-slate-900 tracking-tight">{fmt(totals.total)}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    {loadingPrev && <span>前期間計算中...</span>}
                    {!loadingPrev && revenueChangePct != null && (
                      <>
                        <FontAwesomeIcon icon={revenueChangePct >= 0 ? faArrowTrendUp : faArrowTrendDown} className={revenueChangePct >= 0 ? "text-emerald-600" : "text-red-600"} />
                        <span className={revenueChangePct >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {revenueChangePct >= 0 ? "+" : ""}{revenueChangePct.toFixed(1)}%
                        </span>
                        <span className="text-slate-500">前期間比</span>
                      </>
                    )}
                    {!loadingPrev && revenueChangePct == null && <span>– 前期間比</span>}
                  </div>
                </div>

                {/* 粗利カード: 粗利率は粗利の後ろにカッコ書き */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500 mb-1">粗利</div>
                  <div className="text-2xl font-bold text-slate-900 tracking-tight">
                    {fmt(totals.profit)}
                    {margin != null && <span className="text-lg font-semibold text-slate-600"> ({margin.toFixed(1)}%)</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    {marginDiff != null && (
                      <>
                        <FontAwesomeIcon icon={marginDiff >= 0 ? faArrowTrendUp : faArrowTrendDown} className={marginDiff >= 0 ? "text-emerald-600" : "text-red-600"} />
                        <span className={marginDiff >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {marginDiff >= 0 ? "+" : ""}{marginDiff.toFixed(2)}pt
                        </span>
                        <span className="text-slate-500">粗利率変化</span>
                      </>
                    )}
                    {marginDiff == null && <span>– 粗利率変化</span>}
                  </div>
                </div>

                {/* その他指標: 1日平均・1人あたり・稼働率 */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">1日平均売上</div>
                      <div className="font-semibold text-slate-900">{fmt(Math.round(revenuePerDay))}</div>
                    </div>
                    <hr className="border-slate-100" />
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">1人あたり売上</div>
                      <div className="font-semibold text-slate-900">{fmt(Math.round(revenuePerDriver))}</div>
                    </div>
                    <hr className="border-slate-100" />
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">稼働率</div>
                      <div className="font-semibold text-slate-900">
                        {daysCount > 0 ? `${utilization.toFixed(1)}%` : "–"}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
