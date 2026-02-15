"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";

type Entry = {
  driver: { id: string; name: string };
  report: {
    takuhaibin_completed: number;
    takuhaibin_returned: number;
    nekopos_completed: number;
    nekopos_returned: number;
    submitted_at: string;
  } | null;
};

function todayStr() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export default function AdminDailyPage() {
  const [date, setDate] = useState(todayStr());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = (d: string) => {
    setLoading(true);
    apiFetch<{ entries: Entry[] }>(`/api/admin/daily?date=${d}`)
      .then((res) => setEntries(res.entries))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(date);
  }, [date]);

  const submitted = entries.filter((e) => e.report);
  const notSubmitted = entries.filter((e) => !e.report);

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold text-brand-900 mb-6">日別一覧</h1>

        <div className="mb-6">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-600"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center shadow-sm">
                <div className="text-3xl font-bold text-brand-900">{entries.length}</div>
                <div className="text-sm text-slate-500 mt-1">全ドライバー</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center shadow-sm">
                <div className="text-3xl font-bold text-green-600">{submitted.length}</div>
                <div className="text-sm text-slate-500 mt-1">提出済</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center shadow-sm">
                <div className="text-3xl font-bold text-red-500">{notSubmitted.length}</div>
                <div className="text-sm text-slate-500 mt-1">未提出</div>
              </div>
            </div>

            {/* Not submitted */}
            {notSubmitted.length > 0 && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-red-700 mb-2">未提出</h3>
                <div className="flex flex-wrap gap-2">
                  {notSubmitted.map((e) => (
                    <span key={e.driver.id} className="px-3 py-1 bg-red-100 text-red-700 text-sm rounded-full font-medium">
                      {e.driver.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Table */}
            {submitted.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-left">
                      <th className="py-3 px-4 font-semibold text-slate-600">名前</th>
                      <th className="py-3 px-3 font-semibold text-slate-600 text-right">宅急便完了</th>
                      <th className="py-3 px-3 font-semibold text-slate-600 text-right">宅急便持戻</th>
                      <th className="py-3 px-3 font-semibold text-slate-600 text-right">ネコポス完了</th>
                      <th className="py-3 px-3 font-semibold text-slate-600 text-right">ネコポス持戻</th>
                      <th className="py-3 px-4 font-semibold text-slate-600 text-right">送信時刻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submitted.map((e) => (
                      <tr key={e.driver.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 font-medium">{e.driver.name}</td>
                        <td className="py-3 px-3 text-right tabular-nums">{e.report!.takuhaibin_completed}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-orange-600">{e.report!.takuhaibin_returned}</td>
                        <td className="py-3 px-3 text-right tabular-nums">{e.report!.nekopos_completed}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-orange-600">{e.report!.nekopos_returned}</td>
                        <td className="py-3 px-4 text-right text-xs text-slate-400">
                          {new Date(e.report!.submitted_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
