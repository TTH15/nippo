"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";

type Entry = {
  driver: { id: string; name: string };
  totalTakuhaibinCompleted: number;
  totalTakuhaibinReturned: number;
  totalNekoposCompleted: number;
  totalNekoposReturned: number;
  workDays: number;
  estimatedPayment: number;
};

type MonthlyResponse = {
  month: string;
  rates: { takuhaibin: number; nekopos: number };
  entries: Entry[];
};

function currentMonth() {
  const d = new Date();
  const y = d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", year: "numeric" });
  const m = d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", month: "2-digit" });
  return `${y}-${m}`;
}

export default function AdminMonthlyPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = (m: string) => {
    setLoading(true);
    apiFetch<MonthlyResponse>(`/api/admin/monthly?month=${m}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(month);
  }, [month]);

  const downloadCsv = () => {
    const token = localStorage.getItem("nippo_token");
    const a = document.createElement("a");
    // We need to fetch with auth header, so use fetch API
    fetch(`/api/admin/monthly.csv?month=${month}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        a.href = URL.createObjectURL(blob);
        a.download = `monthly_${month}.csv`;
        a.click();
      });
  };

  const fmt = (n: number) => n.toLocaleString("ja-JP");

  const totalPayment = data?.entries.reduce((s, e) => s + e.estimatedPayment, 0) ?? 0;

  return (
    <AdminLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-brand-900 mb-6">月次集計</h1>

        <div className="flex items-center gap-3 mb-6">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-600"
          />
          <button
            onClick={downloadCsv}
            className="px-4 py-2 bg-brand-800 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
          >
            CSV ダウンロード
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : data ? (
          <>
            {/* Rate info */}
            <div className="flex gap-3 mb-4 text-sm text-slate-500">
              <span>宅急便単価: ¥{fmt(data.rates.takuhaibin)}</span>
              <span>ネコポス単価: ¥{fmt(data.rates.nekopos)}</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 px-4 font-semibold text-slate-600">名前</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-right">稼働日</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-right">宅急便完了</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-right">宅急便持戻</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-right">ネコポス完了</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-right">ネコポス持戻</th>
                    <th className="py-3 px-4 font-semibold text-slate-600 text-right">支払試算</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.driver.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium">{e.driver.name}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{e.workDays}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{fmt(e.totalTakuhaibinCompleted)}</td>
                      <td className="py-3 px-3 text-right tabular-nums text-orange-600">{fmt(e.totalTakuhaibinReturned)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{fmt(e.totalNekoposCompleted)}</td>
                      <td className="py-3 px-3 text-right tabular-nums text-orange-600">{fmt(e.totalNekoposReturned)}</td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold">¥{fmt(e.estimatedPayment)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td colSpan={6} className="py-3 px-4 font-bold text-right text-slate-600">合計</td>
                    <td className="py-3 px-4 text-right tabular-nums font-bold text-brand-800">¥{fmt(totalPayment)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
