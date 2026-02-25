"use client";

import { useState, useMemo, useEffect } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
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

type RangePreset = "current_month" | "six_months" | "one_year" | "custom";

type DateRangeState = {
  start: string;
  end: string;
};

type Tab = "analytics" | "summary";

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getPresetRange(preset: RangePreset, baseEnd?: string): DateRangeState {
  const today = baseEnd ? new Date(baseEnd) : new Date();
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const subMonths = (d: Date, n: number) =>
    new Date(d.getFullYear(), d.getMonth() - n, 1);

  let start: Date;
  const end: Date = today;

  switch (preset) {
    case "six_months":
      start = startOfMonth(subMonths(today, 5));
      break;
    case "one_year":
      start = startOfMonth(subMonths(today, 11));
      break;
    case "current_month":
    case "custom":
    default:
      start = startOfMonth(today);
      break;
  }

  return { start: toLocalYmd(start), end: toLocalYmd(end) };
}

type DateRangeInputsProps = {
  value: DateRangeState;
  onChange: (next: Partial<DateRangeState>) => void;
};

function DateRangeInputs({ value, onChange }: DateRangeInputsProps) {
  return (
    <div className="flex gap-4 items-center flex-wrap">
      <div>
        <label className="text-xs text-slate-400 mb-1 block">開始日</label>
        <input
          type="date"
          value={value.start}
          onChange={(e) => onChange({ start: e.target.value })}
          className="w-[180px] rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-900 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>
      <div className="text-slate-400">〜</div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">終了日</label>
        <input
          type="date"
          value={value.end}
          onChange={(e) => onChange({ end: e.target.value })}
          className="w-[180px] rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-900 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>
    </div>
  );
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
  const [preset, setPreset] = useState<RangePreset>("current_month");
  const [range, setRange] = useState<DateRangeState>(() => getPresetRange("current_month"));
  const [deliveryData, setDeliveryData] = useState<DataPoint[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [midnights, setMidnights] = useState<MidnightRow[]>([]);

  useEffect(() => {
    if (!range.start || !range.end) return;
    setLoadingAnalytics(true);
    apiFetch<{ data: DataPoint[] }>(
      `/api/admin/sales?start=${range.start}&end=${range.end}`,
    )
      .then((res) => setDeliveryData(res.data ?? []))
      .catch(() => setDeliveryData([]))
      .finally(() => setLoadingAnalytics(false));
  }, [range.start, range.end]);

  useEffect(() => {
    if (tab !== "summary" || !range.start || !range.end) return;
    setLoadingSummary(true);
    apiFetch<{
      drivers: DriverRow[];
      reports: ReportRow[];
      midnights: MidnightRow[];
    }>(`/api/admin/sales/reports?start=${range.start}&end=${range.end}`)
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
  }, [range.start, range.end, tab]);

  const displayData = useMemo(() => deliveryData, [deliveryData]);

  const daysInRange = useMemo(() => {
    if (!range.start || !range.end) return [];
    const start = new Date(range.start);
    const end = new Date(range.end);
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
  }, [range.start, range.end]);

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

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">売上</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              アナリティクス（グラフ）と集計（daily_reports表）
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 w-fit mb-6">
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
        </div>

        {tab === "analytics" && (
          <>
            {/* 期間プリセット + 範囲指定 (DateRangePicker / DateRangeDualPicker 風) */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
              <div className="relative inline-flex gap-1 bg-slate-200/50 p-1 rounded-lg backdrop-blur-sm h-[58px] items-center">
                {(
                  [
                    { key: "current_month", label: "今月" },
                    { key: "six_months", label: "半年" },
                    { key: "one_year", label: "1年" },
                    { key: "custom", label: "カスタム" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                        setPreset(p.key);
                        if (p.key !== "custom") {
                          setRange((prev) => getPresetRange(p.key, prev.end));
                        }
                      }}
                    className={`relative px-5 h-full text-sm rounded-md transition-colors z-10 whitespace-nowrap ${
                      preset === p.key ? "text-white" : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {preset === p.key && (
                      <span
                        className="absolute inset-0 bg-black rounded-md"
                        style={{ zIndex: -1 }}
                        aria-hidden
                      />
                    )}
                    {p.label}
                  </button>
                ))}
              </div>
              <DateRangeInputs
                value={range}
                onChange={(next) => {
                  setRange((prev) => ({
                    start: next.start ?? prev.start,
                    end: next.end ?? prev.end,
                  }));
                  setPreset("custom");
                }}
              />
            </div>

            {loadingAnalytics ? (
              <p className="text-sm text-slate-500 py-8">読み込み中...</p>
            ) : displayData.length === 0 ? (
              <p className="text-sm text-slate-500 py-8">該当データがありません</p>
            ) : (
              <>
                {/* サマリーカード */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">総売上</div>
                    <div className="text-lg font-bold text-slate-900">{fmt(totals.total)}</div>
                    <div className="text-[11px] text-slate-400 mt-1">日平均 {fmt(dailyAvg.revenue)}</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">ヤマト売上</div>
                    <div className="text-lg font-bold text-slate-700">{fmt(totals.yamato)}</div>
                    <div className="text-[11px] text-slate-400 mt-1">構成比 {((totals.yamato / totals.total) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">Amazon売上</div>
                    <div className="text-lg font-bold text-slate-400">{fmt(totals.amazon)}</div>
                    <div className="text-[11px] text-slate-400 mt-1">構成比 {((totals.amazon / totals.total) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">総利益</div>
                    <div className="text-lg font-bold text-emerald-600">{fmt(totals.profit)}</div>
                    <div className="text-[11px] text-slate-400 mt-1">日平均 {fmt(dailyAvg.profit)}</div>
                  </div>
                </div>

                {/* チャート */}
                <div className="bg-white rounded-lg border border-slate-200 p-6">
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart data={displayData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                      <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} width={54} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} width={54} />
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
              <p className="text-sm text-slate-500 py-8">読み込み中...</p>
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
                          月計
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
                              const has = tk + nk > 0 || isMidnight;
                              return (
                                <td key={d.iso} className={`px-2 py-2 text-center ${has ? "text-slate-900" : "text-slate-300"}`}>
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
                              <div className="tabular-nums font-semibold text-slate-900">{t.total}</div>
                              <div className="text-[10px] text-slate-400">
                                ヤマト / ミッド{midDays}日
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
      </div>
    </AdminLayout>
  );
}
