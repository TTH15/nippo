"use client";

import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFolder, faFileInvoice, faPenToSquare, faPlus, faTrashCan, faEye } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

type SavedInvoice = {
  direction?: "outgoing" | "incoming";
  counterpartyName?: string;
  id: string;
  clientName: string;
  issueDate: string;
  amount: number;
  status: "draft" | "pending_approval" | "approved" | "paid";
  month?: string;
  section?: "Amazon" | "ヤマト運輸" | "郵便局";
  invoiceNo?: string;
  counterpartyInvoiceAddressId?: string | null;
  updatedAt?: string | null;
};

const statusLabel: Record<SavedInvoice["status"], { text: string; cls: string }> = {
  draft: { text: "下書き", cls: "bg-slate-100 text-slate-600" },
  pending_approval: { text: "承認待ち", cls: "bg-amber-50 text-amber-700" },
  approved: { text: "承認済", cls: "bg-blue-50 text-blue-700" },
  paid: { text: "入金済", cls: "bg-emerald-50 text-emerald-700" },
};

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export default function InvoicesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [invoices, setInvoices] = useState<SavedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCreatePicker, setShowCreatePicker] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });
  const [selectedDirection, setSelectedDirection] = useState<"outgoing" | "incoming">("outgoing");
  const [selectedCounterparty, setSelectedCounterparty] = useState<string>("");
  const [filter, setFilter] = useState<"all" | SavedInvoice["status"]>("all");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const monthFolders = Array.from(new Set((invoices ?? []).map((i) => i.month).filter(Boolean))).sort().reverse();
  const directionFolders = (["outgoing", "incoming"] as const).filter((d) =>
    invoices.some((i) => (i.month ?? "") === selectedMonth && (i.direction ?? "outgoing") === d)
  );
  const counterpartyFolders = Array.from(
    new Set(
      invoices
        .filter(
          (i) =>
            (i.month ?? "") === selectedMonth &&
            (i.direction ?? "outgoing") === selectedDirection
        )
        .map((i) => i.counterpartyName || i.clientName || "未設定")
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "ja"));
  const filtered = (filter === "all" ? invoices : invoices.filter((inv) => inv.status === filter)).filter(
    (inv) =>
      (!selectedMonth || inv.month === selectedMonth) &&
      (inv.direction ?? "outgoing") === selectedDirection &&
      (!selectedCounterparty || (inv.counterpartyName || inv.clientName || "未設定") === selectedCounterparty)
  );
  
  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch<{ invoices: SavedInvoice[] }>(
        `/api/admin/invoices`,
      );
      setInvoices(res.invoices ?? []);
    } catch (e) {
      console.error(e);
      setErrorMessage("請求書一覧の取得に失敗しました。migration未適用やDBエラーの可能性があります。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (invoiceId: string, status: SavedInvoice["status"]) => {
    if (!canWrite) return;
    setUpdatingStatusId(invoiceId);
    try {
      await apiFetch(`/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? { ...inv, status } : inv)));
    } catch (e) {
      console.error(e);
      setErrorMessage("ステータス更新に失敗しました。");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const deleteInvoice = async (invoiceId: string) => {
    if (!canWrite) return;
    if (!window.confirm("この請求書を削除しますか？")) return;
    setDeletingId(invoiceId);
    try {
      await apiFetch(`/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "DELETE",
      });
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId));
    } catch (e) {
      console.error(e);
      setErrorMessage("請求書の削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (directionFolders.length > 0 && !directionFolders.includes(selectedDirection)) {
      setSelectedDirection(directionFolders[0]);
    }
  }, [directionFolders, selectedDirection]);

  useEffect(() => {
    if (counterpartyFolders.length === 0) {
      setSelectedCounterparty("");
      return;
    }
    if (!selectedCounterparty || !counterpartyFolders.includes(selectedCounterparty)) {
      setSelectedCounterparty(counterpartyFolders[0]);
    }
  }, [counterpartyFolders, selectedCounterparty]);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">請求書一覧</h1>
            <p className="text-sm text-slate-500 mt-0.5">登録済みの請求データから請求書を作成・管理</p>
            <p className="text-xs text-slate-400 mt-1">
              <a href="/admin/counterparties" className="underline hover:text-slate-600">
                取引先
              </a>
              からコース単位の集計を見ながら、ワンクリックで下書きを開けます。
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowCreatePicker(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              保存先を選んで作成
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="mb-4 px-3 py-2 text-sm rounded border border-amber-200 bg-amber-50 text-amber-800">
            {errorMessage}
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-1 xl:grid-cols-[160px_180px_240px_1fr]">
            <div className="border-r border-slate-200 min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">年月</div>
              <div className="p-2 space-y-1">
                {monthFolders.length === 0 ? (
                  <p className="text-xs text-slate-400 px-2 py-1">月フォルダがありません</p>
                ) : (
                  monthFolders.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMonth(m!)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                        selectedMonth === m ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                      {m}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="border-r border-slate-200 min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">請求方向</div>
              <div className="p-2 space-y-1">
                {(directionFolders.length === 0 ? (["outgoing", "incoming"] as const) : directionFolders).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setSelectedDirection(dir)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                      selectedDirection === dir ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                    {dir === "outgoing" ? "自社が請求" : "自社に請求"}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-r border-slate-200 min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">取引先</div>
              <div className="p-2 space-y-1">
                {counterpartyFolders.length === 0 ? (
                  <p className="text-xs text-slate-400 px-2 py-1">取引先フォルダがありません</p>
                ) : (
                  counterpartyFolders.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSelectedCounterparty(name)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                        selectedCounterparty === name ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                      {name}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* テーブル */}
            <div className="overflow-x-auto">
            <div className="flex gap-1 p-3 border-b border-slate-100 bg-slate-50/70">
              {([
                { key: "all", label: "すべて" },
                { key: "draft", label: "下書き" },
                { key: "pending_approval", label: "承認待ち" },
                { key: "approved", label: "承認済" },
                { key: "paid", label: "入金済" },
              ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    filter === f.key
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <table className="w-full min-w-[760px] text-sm table-fixed">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-[190px] text-left px-3 py-3 font-medium text-slate-600">請求書番号</th>
                <th className="w-[190px] text-left px-3 py-3 font-medium text-slate-600">取引先</th>
                <th className="w-[110px] text-left px-3 py-3 font-medium text-slate-600">発行日</th>
                <th className="w-[110px] text-right px-3 py-3 font-medium text-slate-600">金額</th>
                <th className="w-[120px] text-center px-3 py-3 font-medium text-slate-600">ステータス</th>
                <th className="w-[130px] text-right px-3 py-3 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    読み込み中...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    該当する請求書はありません
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const s = statusLabel[inv.status];
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 font-mono text-slate-700 break-all">{inv.invoiceNo || inv.id}</td>
                      <td className="px-3 py-3 text-slate-900 font-medium">
                        <div className="inline-flex items-center gap-2 max-w-full">
                          <FontAwesomeIcon icon={faFileInvoice} className="text-slate-400" />
                          <span className="truncate inline-block max-w-[150px]" title={inv.counterpartyName || inv.clientName}>
                            {inv.counterpartyName || inv.clientName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{inv.issueDate}</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-900 whitespace-nowrap">{fmt(inv.amount)}</td>
                      <td className="px-3 py-3 text-center">
                        {canWrite ? (
                          <select
                            value={inv.status}
                            disabled={updatingStatusId === inv.id}
                            onChange={(e) => void updateStatus(inv.id, e.target.value as SavedInvoice["status"])}
                            className={`px-2 py-1 rounded text-xs font-medium border border-slate-200 ${s.cls}`}
                          >
                            <option value="draft">下書き</option>
                            <option value="pending_approval">承認待ち</option>
                            <option value="approved">承認済</option>
                            <option value="paid">入金済</option>
                          </select>
                        ) : (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
                            {s.text}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {canWrite ? (
                          (() => {
                            const href = `/admin/invoices/new?invoiceId=${encodeURIComponent(inv.id)}`;
                            return (
                              <div className="inline-flex items-center gap-2">
                                {inv.status === "pending_approval" && (
                                  <a
                                    href={`/admin/invoices/${encodeURIComponent(inv.id)}/preview`}
                                    title="プレビュー"
                                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                                  >
                                    <FontAwesomeIcon icon={faEye} className="w-3.5 h-3.5" />
                                  </a>
                                )}
                                <a
                                  href={href}
                                  title="編集"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                                </a>
                                <button
                                  type="button"
                                  title="削除"
                                  disabled={deletingId === inv.id}
                                  onClick={() => void deleteInvoice(inv.id)}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-200 text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                >
                                  <FontAwesomeIcon icon={faTrashCan} className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })()
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>

      {showCreatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white border border-slate-200 p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-3">保存先フォルダを選択</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">対象月フォルダ</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">請求方向フォルダ</label>
                <select
                  value={selectedDirection}
                  onChange={(e) => setSelectedDirection(e.target.value as "outgoing" | "incoming")}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                >
                  <option value="outgoing">自社が請求</option>
                  <option value="incoming">自社に請求</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowCreatePicker(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                キャンセル
              </button>
              <a
                href={`/admin/invoices/new?month=${encodeURIComponent(selectedMonth)}&direction=${encodeURIComponent(selectedDirection)}&section=${encodeURIComponent(selectedDirection === "incoming" ? "郵便局" : "ヤマト運輸")}`}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700"
              >
                この保存先で作成
              </a>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
