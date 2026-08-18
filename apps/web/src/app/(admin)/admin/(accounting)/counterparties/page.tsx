"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { preload } from "swr";
import { swrFetcher } from "@/lib/swr";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronRight,
  faFileInvoice,
  faFloppyDisk,
  faBuilding,
  faPenToSquare,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { PixelLoadingOverlay } from "@/lib/components/PixelBoxLoader";
import {
  CounterpartyAddressFields,
  EMPTY_COUNTERPARTY_ADDRESS_FORM,
  counterpartyAddressBody,
  counterpartyAddressFormFrom,
  type CounterpartyAddressForm,
} from "@/lib/components/CounterpartyAddressFields";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
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
  // hover intent 先読み（P8）: 行に 120ms 留まったら明細（billing-detail）を裏取得して
  // SWR キャッシュを温める（展開コンポーネントと同一キー）。通過だけでは撃たない。
  const expandHoverTimerRef = useRef<number | null>(null);
  const prefetchedDetailRef = useRef(new Set<string>());
  const onRowHoverStart = useCallback(
    (counterpartyId: string) => {
      if (expandHoverTimerRef.current != null) window.clearTimeout(expandHoverTimerRef.current);
      expandHoverTimerRef.current = window.setTimeout(() => {
        expandHoverTimerRef.current = null;
        const key = `/api/admin/counterparties/${counterpartyId}/billing-detail?month=${encodeURIComponent(month)}`;
        if (prefetchedDetailRef.current.has(key)) return;
        prefetchedDetailRef.current.add(key);
        void preload(key, swrFetcher);
      }, 120);
    },
    [month],
  );
  const onRowHoverEnd = useCallback(() => {
    if (expandHoverTimerRef.current != null) {
      window.clearTimeout(expandHoverTimerRef.current);
      expandHoverTimerRef.current = null;
    }
  }, []);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createInvoiceError, setCreateInvoiceError] = useState<string | null>(null);
  // 請求書作成〜編集画面への遷移中（ボタンを押せたか分かるよう全画面ローダーを出す）
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  // 取引先の追加・編集は同じモーダル。editingId が null なら新規
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<CounterpartyAddressForm>(EMPTY_COUNTERPARTY_ADDRESS_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
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
    // 全社月次集計（重い）。フォーカス復帰のたびに再集計＋手入力 draft の上書きが走らないようにする
    { revalidateOnFocus: false },
  );
  const loading = isInitialLoading;

  useEffect(() => {
    if (summaryData) setRows(summaryData.rows ?? []);
  }, [summaryData]);

  useEffect(() => {
    if (summaryError) setRows([]);
  }, [summaryError]);

  // サマリーAPIは id / name / 請求メモしか返さない。編集モーダルに現在値を出すため
  // 住所録そのものも取る（他画面と同じキーなので実質キャッシュ共有）。
  const { data: addressData, mutate: mutateAddresses } = useApi<{
    addresses: {
      id: string;
      name: string;
      postal_code: string | null;
      address: string | null;
      phone: string | null;
      invoice_no: string | null;
    }[];
  }>("/api/admin/invoice-addresses");

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

  /** 請求書の宛先として登録されている情報。旧・法人アドレス帳の表示を引き継ぐ。 */
  const renderAddressLines = (id: string) => {
    const a = (addressData?.addresses ?? []).find((x) => x.id === id);
    const lines = [
      a?.postal_code ? `〒 ${a.postal_code}` : null,
      a?.address || null,
      a?.phone ? `電話: ${a.phone}` : null,
      a?.invoice_no ? `登録番号: ${a.invoice_no}` : null,
    ].filter(Boolean) as string[];
    return (
      <div className="text-xs text-slate-600 space-y-0.5">
        {lines.length > 0 ? (
          lines.map((line) => <div key={line}>{line}</div>)
        ) : (
          <div className="text-slate-400">住所・登録番号は未登録</div>
        )}
      </div>
    );
  };

  const openRow = (r: CounterpartySummaryRow) => {
    setExpandedId((id) => (id === r.id ? null : r.id));
    setDraftNotes((d) => ({ ...d, [r.id]: r.billingNotes ?? "" }));
  };

  const openAddModal = () => {
    if (!canWrite) return;
    setEditingId(null);
    setAddForm(EMPTY_COUNTERPARTY_ADDRESS_FORM);
    setShowAddModal(true);
  };

  /** 既存の取引先を編集する（登録番号を後から入れる、住所を直す等）。 */
  const openEditModal = (id: string, fallbackName: string) => {
    if (!canWrite) return;
    const row = (addressData?.addresses ?? []).find((a) => a.id === id);
    setEditingId(id);
    setAddForm(row ? counterpartyAddressFormFrom(row) : { ...EMPTY_COUNTERPARTY_ADDRESS_FORM, name: fallbackName });
    setShowAddModal(true);
  };

  /** 取引先を削除する。請求書やコースから参照されていると DB 側で弾かれる。 */
  const deleteCounterparty = () => {
    if (!canWrite || !editingId) return;
    const id = editingId;
    const name = addForm.name.trim() || "この取引先";
    setConfirmState({
      message: `${name}を削除しますか？`,
      onConfirm: async () => {
        setDeleting(true);
        try {
          await apiFetch(`/api/admin/invoice-addresses/${encodeURIComponent(id)}`, { method: "DELETE" });
          setShowAddModal(false);
          void load();
          void mutateAddresses();
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "取引先の削除に失敗しました",
            message:
              "サーバーでエラーが発生したため、この取引先を削除できませんでした。\n\n" +
              "請求書やコースから既に参照されている場合は削除できません。" +
              "先に参照している側を外してから、もう一度お試しください。",
            detail: reason || undefined,
          });
        } finally {
          setDeleting(false);
        }
      },
    });
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
      await apiFetch(
        editingId ? `/api/admin/invoice-addresses/${encodeURIComponent(editingId)}` : "/api/admin/invoice-addresses",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify(counterpartyAddressBody(addForm)),
        },
      );
      setShowAddModal(false);
      // 名称を変えるとサマリーの行名も変わるため、両方取り直す
      void load();
      void mutateAddresses();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: editingId ? "取引先の保存に失敗しました" : "取引先の追加に失敗しました",
        message:
          `サーバーでエラーが発生したため、取引先を${editingId ? "保存" : "追加"}できませんでした。\n\n` +
          "入力内容（郵便番号・住所・電話番号など）に誤りがないか確認し、もう一度お試しください。\n" +
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
      // 明細の集計・採番・payload組み立てはすべてサーバー側（from-source）に任せる。
      // ここで組み直すと、他の作成導線と中身がズレる。
      const created = await apiFetch<{ invoice: { id: string } }>("/api/admin/invoices/from-source", {
        method: "POST",
        body: JSON.stringify({
          month,
          section: r.suggestedSection,
          source: { type: "counterparty", counterpartyId: r.id },
        }),
      });
      window.location.href = `/admin/invoices/${encodeURIComponent(created.invoice.id)}/edit`;
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
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(r.id, r.name)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700"
                        >
                          <FontAwesomeIcon icon={faPenToSquare} className="w-3 h-3" />
                          取引先を編集
                        </button>
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
                          onMouseEnter={() => onRowHoverStart(r.id)}
                          onMouseLeave={onRowHoverEnd}
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
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditModal(r.id, r.name);
                                  }}
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md px-2 py-1.5 hover:bg-slate-50"
                                  title="住所・電話・インボイス登録番号を編集"
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} className="w-3 h-3" />
                                  編集
                                </button>
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
                              </div>
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
                                <div className="mb-4">
                                  <p className="text-xs font-medium text-slate-500 mb-1">請求書の宛先</p>
                                  {renderAddressLines(r.id)}
                                </div>
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
              <h2 className="text-base font-semibold text-slate-900">
                {editingId ? "取引先を編集" : "取引先を追加"}
              </h2>
            </div>

            <div className="px-5 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
              <CounterpartyAddressFields value={addForm} onChange={setAddForm} disabled={addSaving} />
            </div>

            <div className="px-5 py-3 flex items-center justify-between gap-2 border-t border-slate-100">
              <div>
                {editingId && (
                  <button
                    type="button"
                    onClick={deleteCounterparty}
                    disabled={addSaving || deleting}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleting ? "削除中..." : "削除"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowAddModal(false)}>
                  キャンセル
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={saveNewCounterparty}
                  disabled={addSaving || deleting || !addForm.name.trim()}
                >
                  {addSaving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        onClose={() => setConfirmState(null)}
        confirmLabel="削除"
      />
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
