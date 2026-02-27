"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

type Entry = {
  driver: { id: string; name: string; display_name?: string | null };
  report: {
    report_date: string;
    takuhaibin_completed: number;
    takuhaibin_returned: number;
    nekopos_completed: number;
    nekopos_returned: number;
    submitted_at: string;
    carrier?: "YAMATO" | "AMAZON";
    approved_at?: string | null;
    amazon_am_mochidashi?: number;
    amazon_am_completed?: number;
    amazon_pm_mochidashi?: number;
    amazon_pm_completed?: number;
    amazon_4_mochidashi?: number;
    amazon_4_completed?: number;
  };
};

type Group = {
  date: string;
  entries: Entry[];
};

export default function AdminDailyPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ groups: Group[]; totalPending: number }>("/api/admin/daily/pending")
      .then((res) => setGroups(res.groups))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  const totalPending = groups.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">日報集計</h1>
          <p className="text-xs text-slate-500">
            未承認の日報を日付ごとに表示しています
          </p>
        </div>

        {loading ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-8 w-12 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 px-4"><Skeleton className="h-4 w-12" /></th>
                    <th className="py-3 px-3"><Skeleton className="h-4 w-16 ml-auto" /></th>
                    <th className="py-3 px-3"><Skeleton className="h-4 w-16 ml-auto" /></th>
                    <th className="py-3 px-3"><Skeleton className="h-4 w-16 ml-auto" /></th>
                    <th className="py-3 px-3"><Skeleton className="h-4 w-16 ml-auto" /></th>
                    <th className="py-3 px-4"><Skeleton className="h-4 w-16 ml-auto" /></th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(6)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 px-4"><Skeleton className="h-4 w-24" /></td>
                      <td className="py-3 px-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-4 text-right"><Skeleton className="h-4 w-14 ml-auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-2xl font-bold text-slate-900">{totalPending}</div>
                <div className="text-xs text-slate-500 mt-0.5">未承認の日報</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-2xl font-bold text-slate-900">{groups.length}</div>
                <div className="text-xs text-slate-500 mt-0.5">対象日数</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-2xl font-bold text-slate-900">
                  {groups.length > 0 ? groups[0].date : "-"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">最新の日付</div>
              </div>
            </div>

            {groups.length === 0 && (
              <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
                未承認の日報はありません。
              </div>
            )}

            {groups.map((group) => (
              <div key={group.date} className="mb-8">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-800">
                    {group.date} の日報（未承認 {group.entries.length} 件）
                  </h2>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left">
                        <th className="py-3 px-4 font-semibold text-slate-600">名前</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center">種別</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-right">宅急便完了</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-right">宅急便持戻</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-right">ネコポス完了</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-right">ネコポス持戻</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-left">Amazon（午前/午後/4便）</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center">承認</th>
                        <th className="py-3 px-4 font-semibold text-slate-600 text-right">送信時刻</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((e) => {
                        const r = e.report;
                        const carrier = r.carrier || "YAMATO";
                        const amazonSummary =
                          r.amazon_am_mochidashi ||
                          r.amazon_am_completed ||
                          r.amazon_pm_mochidashi ||
                          r.amazon_pm_completed ||
                          r.amazon_4_mochidashi ||
                          r.amazon_4_completed
                            ? `午前 持出${r.amazon_am_mochidashi ?? 0}/完了${r.amazon_am_completed ?? 0}  午後 持出${r.amazon_pm_mochidashi ?? 0}/完了${r.amazon_pm_completed ?? 0}  4便 持出${r.amazon_4_mochidashi ?? 0}/完了${r.amazon_4_completed ?? 0}`
                            : "-";

                        const handleApprove = async () => {
                          try {
                            await apiFetch("/api/admin/daily/approve", {
                              method: "POST",
                              body: JSON.stringify({ driverId: e.driver.id, date: group.date }),
                            });
                            // 再読み込み
                            setLoading(true);
                            apiFetch<{ groups: Group[]; totalPending: number }>("/api/admin/daily/pending")
                              .then((res) => setGroups(res.groups))
                              .catch(() => setGroups([]))
                              .finally(() => setLoading(false));
                          } catch {
                            // noop
                          }
                        };

                        return (
                          <tr key={e.driver.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-3 px-4 font-medium">{getDisplayName(e.driver)}</td>
                            <td className="py-3 px-3 text-center">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  carrier === "AMAZON"
                                    ? "bg-violet-100 text-violet-700"
                                    : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {carrier === "AMAZON" ? "Amazon" : "ヤマト"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">{r.takuhaibin_completed}</td>
                            <td className="py-3 px-3 text-right tabular-nums text-orange-600">{r.takuhaibin_returned}</td>
                            <td className="py-3 px-3 text-right tabular-nums">{r.nekopos_completed}</td>
                            <td className="py-3 px-3 text-right tabular-nums text-orange-600">{r.nekopos_returned}</td>
                            <td className="py-3 px-3 text-left text-[11px] whitespace-pre-line text-slate-600">
                              {amazonSummary}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={handleApprove}
                                className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                              >
                                承認する
                              </button>
                            </td>
                            <td className="py-3 px-4 text-right text-xs text-slate-400">
                              {new Date(r.submitted_at).toLocaleTimeString("ja-JP", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
