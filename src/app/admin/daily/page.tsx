"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";
import { getStoredDriver } from "@/lib/api";

type ReportData = {
  id?: string;
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

type Entry = {
  driver: { id: string; name: string; display_name?: string | null };
  report: ReportData;
};

type Group = {
  date: string;
  entries: Entry[];
};

type Tab = "pending" | "all";

export default function AdminDailyPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<{ entry: Entry; groupDate: string } | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const canWrite = canAdminWrite(getStoredDriver()?.role);
  const totalEntries = groups.reduce((sum, g) => sum + g.entries.length, 0);

  const load = (targetTab: Tab) => {
    setLoading(true);
    setFetchError(null);
    const url = targetTab === "pending" ? "/api/admin/daily/pending" : "/api/admin/daily/all";
    const cacheOpt = { cache: "no-store" as RequestCache };
    if (targetTab === "pending") {
      apiFetch<{ groups: Group[]; totalPending: number }>(url, cacheOpt)
        .then((res) => setGroups(res.groups ?? []))
        .catch((e) => {
          console.error("[admin/daily] fetch error", e);
          setFetchError(e instanceof Error ? e.message : "日報の取得に失敗しました");
          setGroups([]);
        })
        .finally(() => setLoading(false));
    } else {
      apiFetch<{ groups: Group[] }>(url, cacheOpt)
        .then((res) => setGroups(res.groups ?? []))
        .catch((e) => {
          console.error("[admin/daily] fetch error", e);
          setFetchError(e instanceof Error ? e.message : "日報の取得に失敗しました");
          setGroups([]);
        })
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    load(tab);
  }, [tab]);

  const handleApprove = async (e: Entry, groupDate: string) => {
    try {
      await apiFetch("/api/admin/daily/approve", {
        method: "POST",
        body: JSON.stringify({ driverId: e.driver.id, date: groupDate }),
      });
      // 未承認タブでは承認した行を一覧から削除する（リロード時も同様にAPIが未承認のみ返す）
      setGroups((prev) =>
        prev
          .map((g) =>
            g.date !== groupDate
              ? g
              : { ...g, entries: g.entries.filter((ent) => ent.driver.id !== e.driver.id) }
          )
          .filter((g) => g.entries.length > 0)
      );
    } catch {
      // noop
    }
  };

  const openEdit = (entry: Entry) => {
    const r = entry.report;
    setEditingEntry({ entry, groupDate: r.report_date });
    setEditForm({
      takuhaibin_completed: String(r.takuhaibin_completed ?? 0),
      takuhaibin_returned: String(r.takuhaibin_returned ?? 0),
      nekopos_completed: String(r.nekopos_completed ?? 0),
      nekopos_returned: String(r.nekopos_returned ?? 0),
      carrier: r.carrier || "YAMATO",
      amazon_am_mochidashi: String(r.amazon_am_mochidashi ?? 0),
      amazon_am_completed: String(r.amazon_am_completed ?? 0),
      amazon_pm_mochidashi: String(r.amazon_pm_mochidashi ?? 0),
      amazon_pm_completed: String(r.amazon_pm_completed ?? 0),
      amazon_4_mochidashi: String(r.amazon_4_mochidashi ?? 0),
      amazon_4_completed: String(r.amazon_4_completed ?? 0),
    });
  };

  const saveEdit = async () => {
    if (!editingEntry?.entry.report.id) return;
    setSavingEdit(true);
    try {
      const r = editingEntry.entry.report;
      const carrier = editForm.carrier === "AMAZON" ? "AMAZON" : "YAMATO";
      await apiFetch(`/api/admin/daily/reports/${editingEntry.entry.report.id}`, {
        method: "PUT",
        body: JSON.stringify({
          takuhaibin_completed: Number(editForm.takuhaibin_completed) || 0,
          takuhaibin_returned: Number(editForm.takuhaibin_returned) || 0,
          nekopos_completed: Number(editForm.nekopos_completed) || 0,
          nekopos_returned: Number(editForm.nekopos_returned) || 0,
          carrier,
          amazon_am_mochidashi: Number(editForm.amazon_am_mochidashi) || 0,
          amazon_am_completed: Number(editForm.amazon_am_completed) || 0,
          amazon_pm_mochidashi: Number(editForm.amazon_pm_mochidashi) || 0,
          amazon_pm_completed: Number(editForm.amazon_pm_completed) || 0,
          amazon_4_mochidashi: Number(editForm.amazon_4_mochidashi) || 0,
          amazon_4_completed: Number(editForm.amazon_4_completed) || 0,
        }),
      });
      setEditingEntry(null);
      load(tab);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const isApproved = (r: ReportData) => r.approved_at != null && r.approved_at !== "";

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-bold text-slate-900">日報集計</h1>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
            >
              未承認
            </button>
            <button
              type="button"
              onClick={() => setTab("all")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
            >
              すべて
            </button>
          </div>
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
                    <th className="py-3 px-4"><Skeleton className="h-4 w-16 ml-auto" /></th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(6)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 px-4"><Skeleton className="h-4 w-24" /></td>
                      <td className="py-3 px-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-4"><Skeleton className="h-4 w-14 ml-auto" /></td>
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
                <div className="text-2xl font-bold text-slate-900">
                  {tab === "pending" ? totalEntries : totalEntries}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {tab === "pending" ? "未承認の日報" : "全件数"}
                </div>
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

            {fetchError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
                日報の取得に失敗しました: {fetchError}
              </div>
            )}

            {!fetchError && groups.length === 0 && (
              <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
                {tab === "pending" ? "未承認の日報はありません。" : "日報はありません。"}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.date} className="mb-8">
                <h2 className="text-sm font-semibold text-slate-800 mb-2">
                  {group.date} の日報（{group.entries.length} 件）
                </h2>
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left">
                        <th className="py-3 px-4 font-semibold text-slate-600 w-24">名前</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center w-20">種別</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-left min-w-[200px]">内容</th>
                        <th className="py-3 px-3 font-semibold text-slate-600 text-center w-24">承認</th>
                        {tab === "all" && canWrite && (
                          <th className="py-3 px-3 font-semibold text-slate-600 text-center w-16">操作</th>
                        )}
                        <th className="py-3 px-4 font-semibold text-slate-600 text-right w-30">送信時刻</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((e) => {
                        const r = e.report;
                        const carrier = r.carrier || "YAMATO";
                        const approved = isApproved(r);

                        return (
                          <tr key={`${e.driver.id}-${group.date}`} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-3 px-4 font-medium align-top">{getDisplayName(e.driver)}</td>
                            <td className="py-3 px-3 text-center align-top">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${carrier === "AMAZON"
                                  ? "bg-violet-100 text-violet-700"
                                  : "bg-emerald-100 text-emerald-700"
                                  }`}
                              >
                                {carrier === "AMAZON" ? "Amazon" : "ヤマト"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-left align-top">
                              {carrier === "YAMATO" ? (
                                <div className="text-[13px]">
                                  <span className="text-slate-500 text-xs">宅急便</span>{" "}
                                  <span className="font-semibold text-slate-900 text-base tabular-nums">{r.takuhaibin_completed}</span>
                                  <span className="text-slate-500 text-xs"> 個、ネコポス</span>{" "}
                                  <span className="font-semibold text-slate-900 text-base tabular-nums">{r.nekopos_completed}</span>
                                  <span className="text-slate-500 text-xs"> 個</span>
                                </div>
                              ) : (() => {
                                const am = r.amazon_am_completed ?? 0;
                                const pm = r.amazon_pm_completed ?? 0;
                                const four = r.amazon_4_completed ?? 0;
                                const fourOnly = am === 0 && pm === 0 && four > 0;
                                return fourOnly ? (
                                  <div className="text-[13px]">
                                    <span className="text-slate-500 text-xs">4便</span>{" "}
                                    <span className="font-semibold text-slate-900 text-base tabular-nums">{four}</span>
                                    <span className="text-slate-500 text-xs"> 個</span>
                                  </div>
                                ) : (
                                  <div className="text-[13px] space-y-0.5">
                                    {am > 0 && (
                                      <p><span className="text-slate-500 text-xs">午前</span>{" "}<span className="font-semibold text-slate-900 text-base tabular-nums">{am}</span><span className="text-slate-500 text-xs"> 個</span></p>
                                    )}
                                    {pm > 0 && (
                                      <p><span className="text-slate-500 text-xs">午後</span>{" "}<span className="font-semibold text-slate-900 text-base tabular-nums">{pm}</span><span className="text-slate-500 text-xs"> 個</span></p>
                                    )}
                                    {four > 0 && (
                                      <p><span className="text-slate-500 text-xs">4便</span>{" "}<span className="font-semibold text-slate-900 text-base tabular-nums">{four}</span><span className="text-slate-500 text-xs"> 個</span></p>
                                    )}
                                    {am === 0 && pm === 0 && four === 0 && (
                                      <span className="text-slate-400 text-xs">—</span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-3 px-3 text-center align-top">
                              {approved ? (
                                <span className="inline-flex items-center justify-center w-24 h-6 text-green-600" title="承認済み">
                                  <FontAwesomeIcon icon={faCircleCheck} />
                                </span>
                              ) : tab === "pending" && canWrite ? (
                                <button
                                  type="button"
                                  onClick={() => handleApprove(e, group.date)}
                                  className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                                >
                                  承認する
                                </button>
                              ) : (
                                <span className="text-slate-400 text-xs">未承認</span>
                              )}
                            </td>
                            {tab === "all" && canWrite && (
                              <td className="py-3 px-3 text-center align-top">
                                <button
                                  type="button"
                                  onClick={() => openEdit(e)}
                                  className="text-xs text-slate-600 hover:text-slate-900 underline"
                                >
                                  編集
                                </button>
                              </td>
                            )}
                            <td className="py-3 px-4 text-center text-xs text-slate-400 align-top">
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

      {/* 編集モーダル */}
      {editingEntry && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                日報の編集 — {getDisplayName(editingEntry.entry.driver)}（{editingEntry.groupDate}）
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">種別</label>
                  <select
                    value={editForm.carrier ?? "YAMATO"}
                    onChange={(ev) => setEditForm((f) => ({ ...f, carrier: ev.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                  >
                    <option value="YAMATO">ヤマト</option>
                    <option value="AMAZON">Amazon</option>
                  </select>
                </div>
                {editForm.carrier === "YAMATO" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">宅急便 完了</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.takuhaibin_completed ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, takuhaibin_completed: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">宅急便 持戻</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.takuhaibin_returned ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, takuhaibin_returned: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">ネコポス 完了</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.nekopos_completed ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, nekopos_completed: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">ネコポス 持戻</label>
                      <input
                        type="number"
                        min={0}
                        value={editForm.nekopos_returned ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, nekopos_returned: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午前 持出</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_am_mochidashi ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_am_mochidashi: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午前 完了</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_am_completed ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_am_completed: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午後 持出</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_pm_mochidashi ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_pm_mochidashi: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">午後 完了</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_pm_completed ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_pm_completed: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">4便 持出</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_4_mochidashi ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_4_mochidashi: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-0.5">4便 完了</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.amazon_4_completed ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, amazon_4_completed: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50"
                >
                  {savingEdit ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
