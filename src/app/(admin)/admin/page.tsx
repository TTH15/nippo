"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartColumn,
  faFileLines,
  faCalendar,
  faFileInvoice,
  faMoneyBill1Wave,
  faCar,
  faTriangleExclamation,
  faChevronRight,
  faOilCan,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { todayJST, currentMonthJST } from "@/lib/date";

const yen = (n: number) => `¥${(n || 0).toLocaleString("ja-JP")}`;
const yenShort = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 10000) return `¥${Math.round(v / 1000).toLocaleString("ja-JP")}k`;
  return `¥${v.toLocaleString("ja-JP")}`;
};

type SalesRow = { iso: string; date: string; yamato: number; amazon: number; other: number; profit: number };
type DayBar = { iso: string; label: string; total: number };

export default function AdminDashboardPage() {
  const { month, monthLabel, today, start14 } = useMemo(() => {
    const month = currentMonthJST(); // YYYY-MM
    const [y, m] = month.split("-").map(Number);
    const today = todayJST();
    const base = new Date(today + "T12:00:00+09:00");
    base.setDate(base.getDate() - 13);
    const start14 = base.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    return { month, monthLabel: `${y}年${m}月`, today, start14 };
  }, []);

  const [sales, setSales] = useState(0);
  const [profit, setProfit] = useState(0);
  const [trend, setTrend] = useState<DayBar[]>([]);
  const [dailyUnread, setDailyUnread] = useState<number | null>(null);
  const [oilUnread, setOilUnread] = useState<number | null>(null);
  const [activeDrivers, setActiveDrivers] = useState<number | null>(null);

  // SWR でダッシュボードの集計をまとめてキャッシュし、遷移をまたいで保持する。
  const { data: dash, isInitialLoading } = useApi<{
    sales: number;
    profit: number;
    trend: DayBar[];
    dailyUnread: number | null;
    oilUnread: number | null;
    activeDrivers: number | null;
  }>(`admin/dashboard:${month}:${start14}:${today}`, {
    fetcher: async () => {
      const [monthRes, trendRes, dailyRes, oilRes, shiftRes] = await Promise.all([
        apiFetch<{ data: SalesRow[] }>(`/api/admin/sales?month=${month}`).catch(() => ({ data: [] as SalesRow[] })),
        apiFetch<{ data: SalesRow[] }>(`/api/admin/sales?start=${start14}&end=${today}`).catch(() => ({ data: [] as SalesRow[] })),
        apiFetch<{ unreadCount: number }>(`/api/admin/daily/unread-count`).catch(() => null),
        apiFetch<{ unreadCount: number }>(`/api/admin/misc-reports/oil-change/unread-count`).catch(() => null),
        apiFetch<{ shifts: { driver_id: string | null }[] }>(`/api/admin/shifts?start=${today}&end=${today}`).catch(() => ({ shifts: [] as { driver_id: string | null }[] })),
      ]);
      const monthRows = monthRes.data ?? [];
      const trendRows = (trendRes.data ?? []).map((r) => ({
        iso: r.iso,
        label: r.date,
        total: (r.yamato || 0) + (r.amazon || 0) + (r.other || 0),
      }));
      const uniqueDrivers = new Set(
        (shiftRes.shifts ?? []).map((s) => s.driver_id).filter((id): id is string => !!id),
      );
      return {
        sales: monthRows.reduce((s, r) => s + (r.yamato || 0) + (r.amazon || 0) + (r.other || 0), 0),
        profit: monthRows.reduce((s, r) => s + (r.profit || 0), 0),
        trend: trendRows,
        dailyUnread: dailyRes ? Number(dailyRes.unreadCount) || 0 : null,
        oilUnread: oilRes ? Number(oilRes.unreadCount) || 0 : null,
        activeDrivers: uniqueDrivers.size,
      };
    },
  });
  const loading = isInitialLoading;

  useEffect(() => {
    if (!dash) return;
    setSales(dash.sales);
    setProfit(dash.profit);
    setTrend(dash.trend);
    setDailyUnread(dash.dailyUnread);
    setOilUnread(dash.oilUnread);
    setActiveDrivers(dash.activeDrivers);
  }, [dash]);

  const margin = sales > 0 ? Math.round((profit / sales) * 1000) / 10 : 0;
  const maxTrend = Math.max(1, ...trend.map((d) => d.total));
  const totalAlerts = (dailyUnread ?? 0) + (oilUnread ?? 0);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-4">
        {/* ヘッダー */}
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-slate-900">ダッシュボード</h1>
          <span className="text-xs text-slate-400">{monthLabel}</span>
        </div>

        {/* 今月の概況 KPI */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-5">
            <Kpi label="今月の売上" loading={loading} value={yen(sales)} />
            <Kpi
              label="今月の粗利"
              loading={loading}
              value={yen(profit)}
              sub={`粗利率 ${margin}%`}
            />
          </div>
        </section>

        {/* 直近14日の売上推移 */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-700">直近14日の売上推移</h2>
            <Link href="/admin/sales" className="text-[11px] font-medium text-sky-600 hover:underline">
              詳細を見る
            </Link>
          </div>
          {loading ? (
            <Skeleton className="h-[140px] w-full" />
          ) : trend.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">データがありません</p>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#cbd5e1" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => yenShort(Number(v))}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148,163,184,0.12)" }}
                  formatter={(v) => [yen(Number(v)), "売上"] as [string, string]}
                  labelFormatter={(l) => `${l}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Bar dataKey="total" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {trend.map((d) => (
                    <Cell key={d.iso} fill={d.total >= maxTrend ? "#0f2a52" : "#475569"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* 要対応 + 本日のシフト */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-slate-700">要対応</h2>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : totalAlerts === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-4 text-sm text-emerald-700">
                <FontAwesomeIcon icon={faCircleCheck} className="h-4 w-4" />
                対応が必要な項目はありません
              </div>
            ) : (
              <div className="space-y-2">
                <AlertRow
                  icon={faFileLines}
                  label="未承認の報告"
                  count={dailyUnread ?? 0}
                  href="/admin/daily"
                />
                <AlertRow
                  icon={faOilCan}
                  label="オイル交換の申請"
                  count={oilUnread ?? 0}
                  href="/admin/misc-reports/others"
                />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-slate-700">本日のシフト</h2>
            <Link
              href="/admin/shifts"
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 transition-colors hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                  <FontAwesomeIcon icon={faCalendar} className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[11px] text-slate-500">本日の稼働ドライバー</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums">
                    {loading || activeDrivers == null ? "—" : `${activeDrivers} 人`}
                  </div>
                </div>
              </div>
              <FontAwesomeIcon icon={faChevronRight} className="h-3.5 w-3.5 text-slate-400" />
            </Link>
          </section>
        </div>

        {/* クイックアクセス */}
        <section>
          <div className="mb-2 text-[11px] font-medium text-slate-500">クイックアクセス</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <QuickLink href="/admin/sales" label="売上" icon={faChartColumn} />
            <QuickLink href="/admin/daily" label="報告" icon={faFileLines} />
            <QuickLink href="/admin/shifts" label="シフト" icon={faCalendar} />
            <QuickLink href="/admin/invoices" label="請求書" icon={faFileInvoice} />
            <QuickLink href="/admin/payments" label="ペイメント" icon={faMoneyBill1Wave} />
            <QuickLink href="/admin/vehicles" label="車両" icon={faCar} />
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function Kpi({ label, value, sub, loading }: { label: string; value: string; sub?: string; loading: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-28" />
      ) : (
        <>
          <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">
            {value}
          </div>
          {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
        </>
      )}
    </div>
  );
}

function AlertRow({ icon, label, count, href }: { icon: IconDefinition; label: string; count: number; href: string }) {
  const active = count > 0;
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
        active ? "border-amber-300 bg-amber-50 hover:bg-amber-100" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <FontAwesomeIcon
          icon={active ? faTriangleExclamation : icon}
          className={`h-4 w-4 ${active ? "text-amber-500" : "text-slate-400"}`}
        />
        <span className={`text-sm font-medium ${active ? "text-amber-800" : "text-slate-600"}`}>{label}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
            active ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-400"
          }`}
        >
          {count}
        </span>
        <FontAwesomeIcon icon={faChevronRight} className="h-3 w-3 text-slate-300" />
      </span>
    </Link>
  );
}

function QuickLink({ href, label, icon }: { href: string; label: string; icon: IconDefinition }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-center text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <FontAwesomeIcon icon={icon} className="h-4 w-4 text-slate-500" />
      {label}
    </Link>
  );
}
