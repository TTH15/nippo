"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faCalendar, faCar, faClipboardCheck, faIdCard, faOilCan, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { FleetMapBoard } from "@/lib/components/FleetMapBoard";
import { getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { todayJST } from "@/lib/date";

type Badges = {
  dailyUnread: number | null;
  otherUnread: number | null;
  oilAlert: number | null;
  licenseAlert: number | null;
  pendingApproval: number | null;
};

type Task = { label: string; count: number | null; href: string; icon: IconDefinition };

export default function AdminDashboardPage() {
  const today = useMemo(() => todayJST(), []);
  const dateLabel = useMemo(() => {
    const [year, month, day] = today.split("-");
    const weekday = new Date(`${today}T12:00:00+09:00`).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" });
    return `${year}/${month}/${day}（${weekday}）`;
  }, [today]);
  const [caps, setCaps] = useState<string[] | null>(null);
  useEffect(() => {
    const list = getStoredDriver()?.capabilities;
    setCaps(Array.isArray(list) ? list : null);
  }, []);
  const can = (cap: string) => caps === null || caps.includes(cap);
  const canVehicles = can("can_view_vehicles");
  const canReports = can("can_view_reports");
  const canMembers = can("can_view_members");
  const canShifts = can("can_view_shifts");

  // レイアウトの通知バッジと同じSWRキーを使う。車両位置も地図ページと同じ認可済みAPIから読む。
  const badgesApi = useApi<Badges>("/api/admin/badges");
  const shiftsApi = useApi<{ count: number }>(canShifts ? `/api/admin/shifts?start=${today}&end=${today}&countDrivers=1` : null);
  const badges = badgesApi.data;
  const tasks: Task[] = [
    ...(canMembers ? [
      { label: "参加の承認", count: badges?.pendingApproval ?? null, href: "/admin/users/pending", icon: faUserPlus },
      { label: "免許の確認", count: badges?.licenseAlert ?? null, href: "/admin/users", icon: faIdCard },
    ] : []),
    ...(canReports ? [{ label: "日報の確認", count: badges?.dailyUnread ?? null, href: "/admin/daily", icon: faClipboardCheck }] : []),
    ...(canVehicles ? [
      { label: "オイル交換の申請", count: badges?.otherUnread ?? null, href: "/admin/misc-reports/others", icon: faOilCan },
      { label: "車両の整備確認", count: badges?.oilAlert ?? null, href: "/admin/vehicles", icon: faCar },
    ] : []),
  ];
  const activeTasks = tasks.filter((task) => task.count == null || task.count > 0);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">ダッシュボード</h1>
          <span className="text-xs font-medium text-slate-500">{dateLabel}</span>
        </div>

        {canVehicles && <FleetMapBoard embedded />}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {(canMembers || canReports || canVehicles) && <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-slate-900">要対応</h2>
            {badgesApi.error && <p role="alert" className="mb-3 text-xs text-rose-700">件数を読み込めませんでした。<button type="button" onClick={() => { void badgesApi.refresh(); }} className="ml-1 underline">再読込</button></p>}
            {activeTasks.length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-4 text-sm text-emerald-800">対応待ちはありません</p> : <div className="grid gap-2 sm:grid-cols-2">
              {activeTasks.map((task) => <Link key={task.href} href={task.href} className="flex min-h-14 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-amber-300 hover:bg-amber-50">
                <FontAwesomeIcon icon={task.icon} className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1 font-medium text-slate-800">{task.label}</span>
                <span className="font-bold tabular-nums text-amber-800">{task.count == null ? "—" : task.count}</span>
                <FontAwesomeIcon icon={faArrowRight} className="h-3 w-3 text-slate-400" />
              </Link>)}
            </div>}
          </section>}
          {canShifts && <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-slate-900">今日のシフト</h2>
            <Link href="/admin/shifts" className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:border-amber-300 hover:bg-amber-50">
              <FontAwesomeIcon icon={faCalendar} className="h-4 w-4 text-slate-500" />
              <span className="flex-1 text-sm text-slate-700">稼働予定</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">{shiftsApi.error ? "—" : shiftsApi.data ? `${shiftsApi.data.count}人` : "—"}</span>
              <FontAwesomeIcon icon={faArrowRight} className="h-3 w-3 text-slate-400" />
            </Link>
            {shiftsApi.error && <p role="alert" className="mt-2 text-xs text-rose-700">シフトを読み込めませんでした。<button type="button" onClick={() => { void shiftsApi.refresh(); }} className="ml-1 underline">再読込</button></p>}
          </section>}
        </div>
      </div>
    </AdminLayout>
  );
}
