"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";

const yen = (n: number) => `¥${(n || 0).toLocaleString("ja-JP")}`;

export default function AdminDashboardPage() {
  const { month, start, end, monthLabel } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(y, m, 0).getDate();
    return {
      month: `${y}-${mm}`,
      start: `${y}-${mm}-01`,
      end: `${y}-${mm}-${String(last).padStart(2, "0")}`,
      monthLabel: `${y}年${m}月`,
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState(0);
  const [profit, setProfit] = useState(0);
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [salesRes, unreadRes] = await Promise.all([
          apiFetch<{ data: { yamato: number; amazon: number; other: number; profit: number }[] }>(`/api/admin/sales?month=${month}`).catch(() => ({ data: [] })),
          apiFetch<{ unreadCount: number }>(`/api/admin/daily/unread-count?start=${start}&end=${end}`).catch(() => null),
        ]);
        const rows = salesRes.data ?? [];
        setSales(rows.reduce((s, r) => s + (r.yamato || 0) + (r.amazon || 0) + (r.other || 0), 0));
        setProfit(rows.reduce((s, r) => s + (r.profit || 0), 0));
        setUnread(unreadRes ? unreadRes.unreadCount ?? 0 : null);
      } finally {
        setLoading(false);
      }
    })();
  }, [month, start, end]);

  const margin = sales > 0 ? Math.round((profit / sales) * 1000) / 10 : 0;

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-baseline justify-between mb-5">
          <h1 className="text-lg font-semibold text-slate-900">ダッシュボード</h1>
          <span className="text-xs text-slate-400">{monthLabel}</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card label="今月の売上" value={yen(sales)} />
            <Card label="今月の粗利" value={yen(profit)} sub={`粗利率 ${margin}%`} />
            <Card
              label="未承認の報告"
              value={unread == null ? "—" : `${unread} 件`}
              accent={unread && unread > 0 ? "amber" : undefined}
              href="/admin/daily"
            />
          </div>
        )}

        <div className="mt-6">
          <div className="text-[11px] font-medium text-slate-500 mb-2">クイックアクセス</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <QuickLink href="/admin/sales" label="売上" />
            <QuickLink href="/admin/daily" label="報告" />
            <QuickLink href="/admin/shifts" label="シフト" />
            <QuickLink href="/admin/payments" label="ペイメント" />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function Card({ label, value, sub, accent, href }: { label: string; value: string; sub?: string; accent?: "amber"; href?: string }) {
  const body = (
    <div className={`rounded-lg border bg-white px-4 py-3 ${accent === "amber" ? "border-amber-300" : "border-slate-200"} ${href ? "hover:bg-slate-50 transition-colors" : ""}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${accent === "amber" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-center">
      {label}
    </Link>
  );
}
