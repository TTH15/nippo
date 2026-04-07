"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";
import { getStoredDriver } from "@/lib/api";
import { VehiclePlate } from "@/lib/components/VehiclePlate";

type MiscReport = {
  id: string;
  driver_id: string;
  report_date: string;
  report_time: string;
  location: string;
  report_kind?: string;
  description?: string | null;
  odometer_km: number | null;
  submitted_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  vehicles?: {
    id: string;
    number_prefix?: string | null;
    number_class?: string | null;
    number_hiragana?: string | null;
    number_numeric?: string | null;
    manufacturer?: string | null;
    brand?: string | null;
  } | null;
};

type Entry = {
  driver: { id: string; name: string; display_name: string | null };
  report: MiscReport;
};

function reportKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "repair":
      return "修理";
    case "one_off":
      return "単発案件";
    case "other":
      return "その他";
    case "oil_change":
    default:
      return "オイル交換";
  }
}

export default function AdminOtherReportsPage() {
  const [tab, setTab] = useState<"pending" | "approved">("pending");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canWrite = canAdminWrite(getStoredDriver()?.role);

  const load = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch<{ entries: Entry[] }>(
        `/api/admin/misc-reports/oil-change?status=${tab}`,
        { cache: "no-store" },
      );
      setEntries(res.entries ?? []);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "その他の報告の取得に失敗しました");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    try {
      await apiFetch(`/api/admin/misc-reports/oil-change/${action}`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "操作に失敗しました");
    }
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">その他の報告</h1>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              未承認
            </button>
            <button
              type="button"
              onClick={() => setTab("approved")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === "approved" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              承認履歴
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
            {errorMessage}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">読み込み中...</div>
        ) : entries.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
            {tab === "pending" ? "未承認のその他報告はありません。" : "承認済みのその他報告はありません。"}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 px-4 font-semibold text-slate-600">ドライバー</th>
                    <th className="py-3 px-3 font-semibold text-slate-600">種別</th>
                    <th className="py-3 px-3 font-semibold text-slate-600">日時</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-center">車両</th>
                    <th className="py-3 px-3 font-semibold text-slate-600">場所</th>
                    <th className="py-3 px-3 font-semibold text-slate-600">内容</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-right">走行距離</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-center">
                      {tab === "pending" ? "承認" : "ステータス"}
                    </th>
                    <th className="py-3 px-4 font-semibold text-slate-600 text-right">送信時刻</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(({ driver, report }) => (
                    <tr key={report.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium">{getDisplayName(driver)}</td>
                      <td className="py-3 px-3 text-sm">{reportKindLabel(report.report_kind)}</td>
                      <td className="py-3 px-3 tabular-nums">{report.report_date} {report.report_time}</td>
                      <td className="py-3 px-3 text-center">
                        {report.vehicles ? (
                          <VehiclePlate vehicle={report.vehicles} compact className="max-w-[100px] mx-auto" />
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3">{report.location}</td>
                      <td className="py-3 px-3 text-sm text-slate-700 max-w-[200px]">
                        {report.description?.trim() ? (
                          <span className="whitespace-pre-wrap break-words">{report.description}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {report.odometer_km != null ? `${report.odometer_km.toLocaleString()} km` : "—"}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {tab === "approved" ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
                            承認済み
                          </span>
                        ) : canWrite ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleAction(report.id, "approve")}
                              className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-white hover:bg-slate-700"
                            >
                              承認
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAction(report.id, "reject")}
                              className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
                            >
                              却下
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">未承認</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500 tabular-nums">
                        {new Date(report.submitted_at).toLocaleTimeString("ja-JP", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
