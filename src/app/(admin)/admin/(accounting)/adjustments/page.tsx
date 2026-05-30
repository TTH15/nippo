"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";

// 調整履歴（閲覧専用）。入力は「売上 > 売上調整」タブで行う。
// データは売上ログ(sales_log_entries)を月単位で表示する。

type Entry = {
  id: string;
  log_date: string;
  content: string;
  revenue?: number;
  profit?: number;
  target_driver_id?: string | null;
};

const yen = (n: number) => `¥${(n || 0).toLocaleString("ja-JP")}`;
const fmtSigned = (n: number) => `${n < 0 ? "−" : ""}¥${Math.abs(n || 0).toLocaleString("ja-JP")}`;

export default function AdjustmentsPage() {
  const [offset, setOffset] = useState(0); // 0=今月, -1=先月 ...
  const { month, start, end, label } = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(y, m, 0).getDate();
    return { month: `${y}-${mm}`, start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}`, label: `${y}年${m}月` };
  }, [offset]);

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ entries: Entry[] }>(`/api/admin/sales/log?start=${start}&end=${end}`);
        setEntries((res.entries ?? []).slice().sort((a, b) => b.log_date.localeCompare(a.log_date)));
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [start, end, month]);

  const totalRevenue = entries.reduce((s, e) => s + (e.revenue || 0), 0);
  const totalProfit = entries.reduce((s, e) => s + (e.profit || 0), 0);

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold text-slate-900">調整履歴</h1>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setOffset((o) => o - 1)} className="px-2 py-1 text-slate-500 hover:text-slate-800">‹</button>
            <span className="tabular-nums text-slate-700 w-20 text-center">{label}</span>
            <button onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} className="px-2 py-1 text-slate-500 hover:text-slate-800 disabled:opacity-30">›</button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          売上・利益の手動調整（残業代・立替・リース代等）の履歴です。入力は
          <Link href="/admin/sales" className="text-blue-600 hover:underline mx-1">売上ページの「売上調整」タブ</Link>
          から行います。
        </p>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">この月の調整はありません。</p>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-24">日付</th>
                  <th className="px-3 py-2 text-left font-medium">内容</th>
                  <th className="px-3 py-2 text-right font-medium w-24">売上</th>
                  <th className="px-3 py-2 text-right font-medium w-24">利益</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-500">{e.log_date.slice(5)}</td>
                    <td className="px-3 py-2 text-slate-800">{e.content || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.revenue ? yen(e.revenue) : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${(e.profit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{e.profit ? fmtSigned(e.profit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-medium">
                <tr className="border-t border-slate-200">
                  <td className="px-3 py-2" colSpan={2}>合計</td>
                  <td className="px-3 py-2 text-right tabular-nums">{yen(totalRevenue)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${totalProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtSigned(totalProfit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
