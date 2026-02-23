"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

type Entry = {
  driver: { id: string; name: string; display_name?: string | null };
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

  useEffect(() => {
    setLoading(true);
    apiFetch<{ entries: Entry[] }>(`/api/admin/daily?date=${date}`)
      .then((res) => setEntries(res.entries))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [date]);

  const submitted = entries.filter((e) => e.report);
  const notSubmitted = entries.filter((e) => !e.report);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">日報提出状況確認</h1>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-2xl font-bold text-slate-900">{entries.length}</div>
                <div className="text-xs text-slate-500 mt-0.5">全ドライバー</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-2xl font-bold text-emerald-600">{submitted.length}</div>
                <div className="text-xs text-slate-500 mt-0.5">提出済</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-2xl font-bold text-red-600">{notSubmitted.length}</div>
                <div className="text-xs text-slate-500 mt-0.5">未提出</div>
              </div>
            </div>

            {notSubmitted.length > 0 && (
              <div className="mb-6 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                <h3 className="text-sm font-semibold text-red-700 mb-2">未提出</h3>
                <div className="flex flex-wrap gap-2">
                  {notSubmitted.map((e) => (
                    <span
                      key={e.driver.id}
                      className="px-3 py-1 bg-red-100 text-red-700 text-sm rounded-full font-medium"
                    >
                      {getDisplayName(e.driver)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {submitted.length > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
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
                        <td className="py-3 px-4 font-medium">{getDisplayName(e.driver)}</td>
                        <td className="py-3 px-3 text-right tabular-nums">{e.report!.takuhaibin_completed}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-orange-600">{e.report!.takuhaibin_returned}</td>
                        <td className="py-3 px-3 text-right tabular-nums">{e.report!.nekopos_completed}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-orange-600">{e.report!.nekopos_returned}</td>
                        <td className="py-3 px-4 text-right text-xs text-slate-400">
                          {new Date(e.report!.submitted_at).toLocaleTimeString("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
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
