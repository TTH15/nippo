"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronRight,
  faFileInvoice,
  faFloppyDisk,
  faBuilding,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { PixelLoadingOverlay } from "@/lib/components/PixelBoxLoader";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";
import { Button } from "@/lib/ui/button";
import { CounterpartyBillingExpand } from "./CounterpartyBillingExpand";

type CourseRow = {
  id: string;
  name: string;
  carrier: "YAMATO" | "AMAZON" | "OTHER";
};

type CounterpartySummaryRow = {
  id: string;
  name: string;
  billingNotes: string;
  courseCount: number;
  courses: CourseRow[];
  systemRevenue: number;
  salesLogRevenueTotal: number;
  salesLogDeductionTotal: number;
  customMainTotal: number;
  customDeductionTotal: number;
  monthTotal: number;
  suggestedSection: "Amazon" | "ヤマト運輸" | "郵便局";
};

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function monthStrFromYm(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function CounterpartiesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return monthStrFromYm(d.getFullYear(), d.getMonth() + 1);
  });
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [rows, setRows] = useState<CounterpartySummaryRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createInvoiceError, setCreateInvoiceError] = useState<string | null>(null);
  // 請求書作成〜編集画面への遷移中（ボタンを押せたか分かるよう全画面ローダーを出す）
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    postalCode: "",
    address: "",
    phone: "",
    invoiceNo: "",
  });
  const [addSaving, setAddSaving] = useState(false);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_billing"));
  }, []);

  // SWR で月別サマリをキャッシュし、遷移をまたいで保持する（再訪時の点滅をなくす）。
  const {
    data: summaryData,
    error: summaryError,
    isInitialLoading,
    mutate: mutateSummary,
  } = useApi<{ month: string; rows: CounterpartySummaryRow[] }>(
    `/api/admin/counterparties/summary?month=${encodeURIComponent(month)}`,
  );
  const loading = isInitialLoading;

  useEffect(() => {
    if (summaryData) setRows(summaryData.rows ?? []);
  }, [summaryData]);

  useEffect(() => {
    if (summaryError) setRows([]);
  }, [summaryError]);

  // 書き込み後の再取得（旧 load の代替）。
  const load = useCallback(() => mutateSummary(), [mutateSummary]);

  const saveNotes = async (id: string) => {
    if (!canWrite) return;
    setSavingId(id);
    try {
      await apiFetch(`/api/admin/invoice-addresses/${id}`, {
        method: "PUT",
        body: JSON.stringify({ billingNotes: draftNotes[id] ?? "" }),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, billingNotes: draftNotes[id] ?? "" } : r))
      );
      void load(); // キャッシュも確定（待たない）
    } catch (e) {
      console.error(e);
      // ローカルは先に書き換わっているため、黙って失敗すると保存できたように見える
      setErrorState({
        title: "請求メモの保存に失敗しました",
        message: e instanceof Error ? e.message : "もう一度お試しください。",
      });
    } finally {
      setSavingId(null);
    }
  };

  const openRow = (r: CounterpartySummaryRow) => {
    setExpandedId((id) => (id === r.id ? null : r.id));
    setDraftNotes((d) => ({ ...d, [r.id]: r.billingNotes ?? "" }));
  };

  const openAddModal = () => {
    if (!canWrite) return;
    setAddForm({ name: "", postalCode: "", address: "", phone: "", invoiceNo: "" });
    setShowAddModal(true);
  };

  const saveNewCounterparty = async () => {
    if (!canWrite) return;
    if (!addForm.name.trim()) {
      setErrorState({
        title: "会社名が入力されていません",
        message: "取引先名は請求書の宛先として必須です。会社名を入力してから、もう一度保存してください。",
      });
      return;
    }
    setAddSaving(true);
    try {
      await apiFetch("/api/admin/invoice-addresses", {
        method: "POST",
        body: JSON.stringify({
          name: addForm.name.trim(),
          postalCode: addForm.postalCode.trim() || null,
          address: addForm.address.trim() || null,
          phone: addForm.phone.trim() || null,
          invoiceNo: addForm.invoiceNo.trim() || null,
        }),
      });
      setShowAddModal(false);
      void load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "取引先の追加に失敗しました",
        message:
          "サーバーでエラーが発生したため、取引先を追加できませんでした。\n\n" +
          "入力内容（郵便番号・住所・電話番号など）に誤りがないか確認し、もう一度追加してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setAddSaving(false);
    }
  };

  /** 取引先から請求書の下書きを作成して編集画面へ（テーブル・カード両方から使う） */
  const createInvoiceForCounterparty = async (r: CounterpartySummaryRow) => {
    if (creatingInvoice) return;
    setCreateInvoiceError(null);
    setCreatingInvoice(true); // 成功時は遷移までオーバーレイを出し続ける（失敗時のみ解除）
    try {
      const res = await apiFetch<{ month: string; issueDate: string; dueDate: string; invoiceNo: string; tableData: { main: { title: string; qty: number; price: number }[]; deduct: { title: string; qty: number; price: number }[] } }>(
        `/api/admin/invoices/draft?month=${encodeURIComponent(month)}&section=${encodeURIComponent(r.suggestedSection)}&counterparty=${encodeURIComponent(r.id)}`
      );
      const amount =
        (res.tableData?.main ?? []).reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0) -
        (res.tableData?.deduct ?? []).reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0);
      const issueDateJp = `${res.issueDate.slice(0, 4)}年${Number(
        res.issueDate.slice(5, 7),
      )}月${Number(res.issueDate.slice(8, 10))}日`;
      const dueDateJp = `${res.dueDate.slice(0, 4)}年${Number(
        res.dueDate.slice(5, 7),
      )}月${Number(res.dueDate.slice(8, 10))}日`;
      const payload = {
        issueDate: issueDateJp,
        dueDate: dueDateJp,
        invoiceNo: res.invoiceNo,
        tableData: res.tableData,
        toName: r.name,
        subject: `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月稼働分`,
        section: r.suggestedSection,
      };
      const created = await apiFetch<{ invoice: { id: string } }>("/api/admin/invoices", {
        method: "POST",
        body: JSON.stringify({
          month,
          section: r.suggestedSection,
          counterpartyInvoiceAddressId: r.id,
          clientName: r.name,
          issueDate: res.issueDate,
          invoiceNo: res.invoiceNo,
          amount,
          status: "draft",
          payload,
        }),
      });
      window.location.href = `/admin/invoices/new?invoiceId=${encodeURIComponent(
        created.invoice.id,
      )}&month=${encodeURIComponent(month)}&direction=outgoing&section=${encodeURIComponent(
        r.suggestedSection,
      )}&counterparty=${encodeURIComponent(r.id)}`;
    } catch (e) {
      console.error(e);
      setCreatingInvoice(false);
      setCreateInvoiceError("請求書の保存に失敗しました。DB migration適用状況とAPIエラーをご確認ください。");
    }
  };

  return (
    <AdminLayout>
      {creatingInvoice && (
        <PixelLoadingOverlay message="請求書を作成しています…" subMessage="作成後、編集画面に移動します" />
      )}
      <div className="w-full max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <FontAwesomeIcon icon={faBuilding} className="w-5 h-5 text-slate-400" />
              取引先
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              コース別の自動集計、売上ログ（単発案件など）、手入力の加算・控除をまとめて管理します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <MonthYearPicker
              value={ym}
              onChange={(v) => {
                setYm(v);
                setMonth(monthStrFromYm(v.year, v.month));
              }}
              placeholder="対象月"
            />
            <Link
              href="/admin/invoices"
              className="text-sm text-slate-600 hover:text-slate-900 underline underline-offset-2"
            >
              請求書一覧
            </Link>
            {canWrite && (
              <Button variant="default" size="default" onClick={openAddModal}>
                <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                新規追加
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 mb-4">
          月次合計は「シフト集計＋売上ログ（取引先指定）＋手入力加算 −
          売上ログのマイナス利益 − 手入力控除」です。摘要は明細表でフォーカスアウト時に保存されます。郵便局帯の
          sales_log 会社集計とは定義が異なる場合があります。
        </div>
        {createInvoiceError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 mb-4">
            {createInvoiceError}
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          {/* スマホ: カード表示。6列テーブルの横スクロールと、展開部との
              二重横スクロール（外800px × 内720px）を避ける */}
          <div className="md:hidden divide-y divide-slate-100">
            {loading ? (
              <p className="px-4 py-10 text-center text-slate-400">読み込み中…</p>
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-slate-400">
                <p className="mb-3">取引先がまだ登録されていません。</p>
                {canWrite && (
                  <Button variant="default" size="default" onClick={openAddModal}>
                    <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                    取引先を追加
                  </Button>
                )}
              </div>
            ) : (
              rows.map((r) => {
                const open = expandedId === r.id;
                return (
                  <div key={r.id} className={`px-3 py-2.5 ${r.courseCount === 0 ? "opacity-60" : ""}`}>
                    <button type="button" onClick={() => openRow(r)} className="flex w-full items-center gap-2 text-left">
                      <FontAwesomeIcon
                        icon={open ? faChevronDown : faChevronRight}
                        className="w-3 h-3 shrink-0 text-slate-400"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          コース {r.courseCount}
                          {r.billingNotes ? `・${r.billingNotes.replace(/\s+/g, " ").slice(0, 20)}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {fmt(r.monthTotal)}
                      </span>
                    </button>
                    {canWrite && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void createInvoiceForCounterparty(r)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700"
                        >
                          <FontAwesomeIcon icon={faFileInvoice} className="w-3 h-3" />
                          請求書を保存して編集
                        </button>
                      </div>
                    )}
                    {open && (
                      <div className="mt-3">
                        <CounterpartyBillingExpand
                          counterpartyId={r.id}
                          month={month}
                          canWrite={canWrite}
                          onRefreshSummary={() => void load()}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {/* PC: 従来のテーブル */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[800px] md:min-w-0">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky left-0 z-20 bg-slate-50 text-left px-3 py-3 font-medium text-slate-600 w-10" />
                  <th className="sticky left-10 z-20 bg-slate-50 text-left px-3 py-3 font-medium text-slate-600">取引先（請求先）</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">コース数</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">月次純額</th>
                  <th className="text-left px-3 py-3 font-medium text-slate-600">メモ</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">請求書</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      読み込み中…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      <p className="mb-3">取引先がまだ登録されていません。</p>
                      {canWrite && (
                        <Button variant="default" size="default" onClick={openAddModal}>
                          <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                          取引先を追加
                        </Button>
                      )}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const open = expandedId === r.id;
                    const firstLine = (r.billingNotes || "").split("\n")[0] ?? "";
                    const memoPreview =
                      firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
                    const tip = [
                      `シフト集計 ${fmt(r.systemRevenue)}`,
                      r.salesLogRevenueTotal ? `ログ＋ ${fmt(r.salesLogRevenueTotal)}` : null,
                      r.customMainTotal ? `手入力＋ ${fmt(r.customMainTotal)}` : null,
                      r.salesLogDeductionTotal ? `ログ控除 −${fmt(r.salesLogDeductionTotal)}` : null,
                      r.customDeductionTotal ? `手控除 −${fmt(r.customDeductionTotal)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" / ");

                    return (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() => openRow(r)}
                          className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50/80 ${
                            r.courseCount === 0 ? "opacity-60" : ""
                          }`}
                        >
                          <td className={`sticky left-0 z-10 px-1 py-2 text-center ${open ? "bg-slate-50" : "bg-white"}`}>
                            <span
                              className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-400"
                              aria-hidden
                            >
                              <FontAwesomeIcon
                                icon={open ? faChevronDown : faChevronRight}
                                className="w-3 h-3"
                              />
                            </span>
                          </td>
                          <td className={`sticky left-10 z-10 px-3 py-2 font-medium text-slate-900 ${open ? "bg-slate-50" : "bg-white"}`}>{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {r.courseCount}
                          </td>
                          <td
                            className="px-3 py-2 text-right font-medium text-slate-900 tabular-nums"
                            title={tip}
                          >
                            {fmt(r.monthTotal)}
                          </td>
                          <td
                            className="px-3 py-2 text-slate-600 text-xs max-w-[200px] truncate"
                            title={r.billingNotes || undefined}
                          >
                            {memoPreview.trim() ? memoPreview : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canWrite ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void createInvoiceForCounterparty(r);
                                }}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md px-2 py-1.5 hover:bg-slate-50"
                              >
                                <FontAwesomeIcon icon={faFileInvoice} className="w-3 h-3" />
                                請求書を保存して編集
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/90 border-b border-slate-100">
                            <td colSpan={6} className="px-4 py-4">
                              <CounterpartyBillingExpand
                                counterpartyId={r.id}
                                month={month}
                                canWrite={canWrite}
                                onRefreshSummary={() => void load()}
                              />
                              <div className="mt-6 pt-4 border-t border-slate-200">
                                <label className="block text-xs font-medium text-slate-500 mb-1">
                                  社内メモ（請求書には出力されません）
                                </label>
                                <textarea
                                  className="w-full min-h-[80px] text-sm border border-slate-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-slate-300 focus:border-slate-300 outline-none"
                                  value={draftNotes[r.id] ?? ""}
                                  disabled={!canWrite}
                                  onChange={(e) =>
                                    setDraftNotes((d) => ({ ...d, [r.id]: e.target.value }))
                                  }
                                  placeholder="契約・連絡メモ…"
                                />
                                {canWrite && (
                                  <button
                                    type="button"
                                    onClick={() => void saveNotes(r.id)}
                                    disabled={savingId === r.id}
                                    className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    <FontAwesomeIcon icon={faFloppyDisk} className="w-3 h-3" />
                                    {savingId === r.id ? "保存中…" : "メモを保存"}
                                  </button>
                                )}
                                <p className="text-[11px] text-slate-500 mt-2">
                                  請求書の帯域の提案: {r.suggestedSection}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAddModal && canWrite && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">取引先を追加</h2>
              <p className="text-xs text-slate-500 mt-1">
                請求書の宛先（法人アドレス帳）に登録します。個人（ドライバー）はドライバー管理で登録してください。
              </p>
            </div>

            <div className="px-5 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">会社名 *</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="株式会社○○"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">郵便番号</label>
                <input
                  type="text"
                  value={addForm.postalCode}
                  onChange={(e) => setAddForm((f) => ({ ...f, postalCode: e.target.value }))}
                  placeholder="123-4567"
                  maxLength={8}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">住所</label>
                <input
                  type="text"
                  value={addForm.address}
                  onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="東京都○○区○○1-2-3"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">電話番号</label>
                <input
                  type="text"
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="03-1234-5678"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">インボイス登録番号</label>
                <input
                  type="text"
                  value={addForm.invoiceNo}
                  onChange={(e) => setAddForm((f) => ({ ...f, invoiceNo: e.target.value }))}
                  placeholder="T1234567890123"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <Button variant="ghost" size="sm" onClick={() => setShowAddModal(false)}>
                キャンセル
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={saveNewCounterparty}
                disabled={addSaving || !addForm.name.trim()}
              >
                {addSaving ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
