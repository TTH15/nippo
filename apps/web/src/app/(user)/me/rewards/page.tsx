"use client";

import { useEffect, useState, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileInvoice } from "@fortawesome/free-solid-svg-icons";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { ExpenseSection } from "@/lib/components/ExpenseSection";
import { FixedExpenseSection } from "@/lib/components/FixedExpenseSection";
import { PaymentSummary } from "@/lib/components/PaymentSummary";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type {
  InvoiceRow,
  InvoiceAttachment,
  RewardsSummary,
  MyInvoice,
} from "@/core/types";
import { nowYearMonth1, formatYearMonth, formatMonthDayJP } from "@/core/logic/calendar";
import {
  isUploadedDocument,
  mergedDetails,
  pendingInvoices,
  formatYen,
  logLabel,
  sumRows,
  parseRow,
  invoiceLines,
} from "@/core/logic/reward";

export default function MeRewardsPage() {
  const [rewardMonth, setRewardMonth] = useState(nowYearMonth1);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [optionalSubmitting, setOptionalSubmitting] = useState(false);
  const [optionalError, setOptionalError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [invoices, setInvoices] = useState<MyInvoice[]>([]);
  const [approvingInvoiceId, setApprovingInvoiceId] = useState<string | null>(null);
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);

  const monthStr = formatYearMonth(rewardMonth.year, rewardMonth.month);

  // 報酬サマリを SWR キャッシュ（月キー、遷移をまたいで保持）。
  const {
    data: rewardsData,
    error: rewardsFetchError,
    isInitialLoading: rewardsLoading,
    mutate: mutateRewards,
  } = useApi<RewardsSummary>(`/api/me/rewards?month=${monthStr}`);

  useEffect(() => {
    if (rewardsData) {
      setRewards(rewardsData);
      setRewardsError(null);
    }
  }, [rewardsData]);

  useEffect(() => {
    if (rewardsFetchError) setRewardsError("報酬サマリの取得に失敗しました");
  }, [rewardsFetchError]);

  // 書き込み後の再取得（旧 loadRewards の代替）。
  const loadRewards = useCallback(() => mutateRewards(), [mutateRewards]);

  // 承認待ち請求書を SWR キャッシュ。pending_approval のみ表示。
  const {
    data: invoicesData,
    isInitialLoading: invoicesLoading,
    mutate: mutateInvoices,
  } = useApi<{ invoices: MyInvoice[] }>("/api/me/invoices");

  useEffect(() => {
    if (invoicesData) {
      setInvoices(pendingInvoices(invoicesData.invoices ?? []));
    }
  }, [invoicesData]);

  const handleAddOptional = async (name: string, amount: number) => {
    setOptionalError(null);
    setOptionalSubmitting(true);
    try {
      await apiFetch("/api/me/optional-expenses", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, name, amount }),
      });
      loadRewards();
    } catch (err: unknown) {
      setOptionalError(err instanceof Error ? err.message : "追加に失敗しました");
      throw err;
    } finally {
      setOptionalSubmitting(false);
    }
  };

  const handleDeleteOptional = async (id: string) => {
    try {
      await apiFetch(`/api/me/optional-expenses/${id}`, { method: "DELETE" });
      loadRewards();
    } catch (e) {
      console.error(e);
    }
  };

  const handleApproveInvoice = async (invoiceId: string) => {
    setApprovingInvoiceId(invoiceId);
    try {
      await apiFetch(`/api/me/invoices/${encodeURIComponent(invoiceId)}/approve`, { method: "POST" });
      const res = await mutateInvoices();
      const pendingOnly = pendingInvoices(res?.invoices ?? []);
      // 承認完了後はプレビューを閉じ、残件がなければ一覧モーダルも閉じる
      setPreviewInvoiceId(null);
      if (pendingOnly.length === 0) {
        setInvoicePanelOpen(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setApprovingInvoiceId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-900">報酬</h1>
        <button
          type="button"
          onClick={() => setInvoicePanelOpen(true)}
          className="relative inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <FontAwesomeIcon icon={faFileInvoice} className="w-4 h-4" />
          請求書
          {invoices.length > 0 && (
            <span className="absolute -top-2 -right-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold">
              {invoices.length}
            </span>
          )}
        </button>
      </div>

      <div className="mb-3">
        <MonthYearPicker
          value={rewardMonth}
          onChange={setRewardMonth}
          placeholder="年月を選択"
        />
      </div>

      {rewardsLoading ? (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-40" />
            <div className="grid grid-cols-3 gap-2 mt-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <Skeleton className="h-4 w-24 mb-2" />
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : rewardsError ? (
        <p className="text-sm text-red-600">{rewardsError}</p>
      ) : !rewards ? (
        <p className="text-sm text-slate-500">報酬情報を取得できませんでした</p>
      ) : (
        <div className="space-y-4">
          <PaymentSummary
            income={rewards.incomeLog}
            companyExpenses={rewards.fixedDeductions}
            customExpenses={rewards.optionalDeductions ?? 0}
            leaseExpenses={rewards.leaseDeductions ?? 0}
            selectedDate={new Date(rewardMonth.year, rewardMonth.month - 1, 1)}
          />

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="flex items-center justify-between w-full text-left py-1 text-sm font-semibold text-slate-800 hover:text-slate-900"
            >
              <span>詳細</span>
              <span className="text-slate-400">{detailsOpen ? "▲" : "▼"}</span>
            </button>
            {detailsOpen && (() => {
              const details = mergedDetails(rewards);
              return (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-sm text-slate-700">
                {details.length === 0 ? (
                  <p className="text-slate-500">この月の明細はありません</p>
                ) : (
                  details.map((l, idx) => (
                    <div key={`${l.log_date}-${l.type_name}-${idx}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
                      <span className="text-slate-600 font-medium">{formatMonthDayJP(l.log_date)}</span>
                      <span className="text-slate-800">{logLabel(l)}</span>
                      <span className="text-slate-900 font-semibold">{formatYen(l.amount)}</span>
                    </div>
                  ))
                )}
              </div>
              );
            })()}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
            <FixedExpenseSection expenses={rewards.fixedDetails} />

            <ExpenseSection
              expenses={rewards.optionalDetails ?? []}
              onAddExpense={handleAddOptional}
              onDeleteExpense={handleDeleteOptional}
              submitting={optionalSubmitting}
              error={optionalError}
            />
          </div>
        </div>
      )}

      {invoicePanelOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center"
          onClick={() => setInvoicePanelOpen(false)}
        >
          <div
            className="w-full max-w-xl max-h-[90vh] bg-white rounded-lg shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">請求書確認</div>
              <button
                type="button"
                onClick={() => setInvoicePanelOpen(false)}
                className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(90vh-49px)] space-y-3">
              {invoicesLoading ? (
                <p className="text-xs text-slate-500">読み込み中...</p>
              ) : invoices.length === 0 ? (
                <p className="text-xs text-slate-500">現在、承認待ちの請求書はありません。</p>
              ) : (
                invoices.map((inv) => (
                  <div key={inv.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-600">{inv.invoiceNo || inv.id}</div>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700">承認待ち</span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {isUploadedDocument(inv)
                        ? "確認文書"
                        : `${inv.amount.toLocaleString("ja-JP")}円`}
                    </div>
                    {isUploadedDocument(inv) && (
                      <div className="mt-0.5 text-xs text-slate-500">
                        添付 {invoiceLines(inv).attachments.length} 件
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewInvoiceId(inv.id)}
                        className="col-span-2 rounded-md border border-slate-300 text-slate-700 text-sm py-2"
                      >
                        内容を確認する
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {previewInvoiceId && (
        <div
          className="fixed inset-0 z-[120] bg-black/50 p-2 sm:p-4 flex items-center justify-center overflow-y-auto"
          onClick={() => setPreviewInvoiceId(null)}
        >
          <div
            className="w-full max-w-3xl h-[calc(100dvh-12px)] sm:h-auto sm:max-h-[90vh] bg-white rounded-lg shadow-lg overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">請求書プレビュー</div>
              <button
                type="button"
                onClick={() => setPreviewInvoiceId(null)}
                className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div
              className="p-4 pb-6 overflow-y-auto flex-1 min-h-0 overscroll-contain"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {(() => {
                const inv = invoices.find((x) => x.id === previewInvoiceId);
                if (!inv) {
                  return <p className="text-sm text-slate-500">請求書データが見つかりません。</p>;
                }
                const isDoc = isUploadedDocument(inv);
                const { main: mainLines, deduct: deductLines, attachments } = invoiceLines(inv);
                const mainTotal = sumRows(mainLines);
                const deductTotal = sumRows(deductLines);
                return (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {inv.invoiceNo || inv.id}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            請求日: {inv.payload?.issueDate || inv.issueDate || "-"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">{isDoc ? "文書種別" : "請求額"}</div>
                          <div className="text-lg font-bold text-slate-900">
                            {isDoc ? "確認文書" : `${Number(inv.amount || 0).toLocaleString("ja-JP")}円`}
                          </div>
                        </div>
                      </div>
                    </div>

                    {!isDoc && (
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100">売上明細</div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[420px] text-sm">
                            <thead className="bg-white border-b border-slate-200">
                              <tr>
                                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">摘要</th>
                                <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">数量</th>
                                <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">単価</th>
                                <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">金額</th>
                              </tr>
                            </thead>
                            <tbody>
                              {mainLines.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-3 py-3 text-center text-slate-500 text-xs">
                                    売上明細はありません
                                  </td>
                                </tr>
                              ) : (
                                mainLines.map((row: InvoiceRow, idx: number) => {
                                  const { qty, price, amount } = parseRow(row);
                                  return (
                                    <tr key={`main-${idx}`} className="border-t border-slate-100">
                                      <td className="px-3 py-2 text-slate-800 max-w-[20ch] truncate whitespace-nowrap" title={row?.title || "明細"}>
                                        {row?.title || "明細"}
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{qty.toLocaleString("ja-JP")}</td>
                                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{price.toLocaleString("ja-JP")}円</td>
                                      <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">{amount.toLocaleString("ja-JP")}円</td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {attachments.length > 0 && (
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100">添付ファイル</div>
                        <div className="p-3 space-y-3">
                          {attachments.map((f: InvoiceAttachment, idx: number) => {
                            const type = String(f?.type || "");
                            const url = String(f?.dataUrl || "");
                            if (!url) return null;
                            return (
                              <div key={`att-${idx}`} className="space-y-2">
                                <div className="text-xs text-slate-600">{f?.name || `添付ファイル ${idx + 1}`}</div>
                                {type.startsWith("image/") ? (
                                  <img src={url} alt={f?.name || "attachment"} className="w-full rounded border border-slate-200" />
                                ) : type === "application/pdf" ? (
                                  <iframe src={url} className="w-full h-80 border border-slate-200 rounded" title={`pdf-${idx}`} />
                                ) : (
                                  <a href={url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">
                                    ファイルを開く
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!isDoc && (
                      <>
                        <div className="rounded-lg border border-slate-200 overflow-hidden">
                          <div className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100">控除明細</div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[420px] text-sm">
                              <thead className="bg-white border-b border-slate-200">
                                <tr>
                                  <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">摘要</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">数量</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">単価</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">金額</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deductLines.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-3 py-3 text-center text-slate-500 text-xs">
                                      控除明細はありません
                                    </td>
                                  </tr>
                                ) : (
                                  deductLines.map((row: InvoiceRow, idx: number) => {
                                    const { qty, price, amount } = parseRow(row);
                                    return (
                                      <tr key={`deduct-${idx}`} className="border-t border-slate-100">
                                        <td className="px-3 py-2 text-slate-800 max-w-[20ch] truncate whitespace-nowrap" title={row?.title || "控除"}>
                                          {row?.title || "控除"}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{qty.toLocaleString("ja-JP")}</td>
                                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{price.toLocaleString("ja-JP")}円</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">{amount.toLocaleString("ja-JP")}円</td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                          <div className="flex justify-between py-1">
                            <span className="text-slate-600">売上合計</span>
                            <span className="tabular-nums font-medium">{mainTotal.toLocaleString("ja-JP")}円</span>
                          </div>
                          <div className="flex justify-between py-1">
                            <span className="text-slate-600">控除合計</span>
                            <span className="tabular-nums font-medium">-{deductTotal.toLocaleString("ja-JP")}円</span>
                          </div>
                          <div className="flex justify-between pt-2 mt-2 border-t border-slate-200">
                            <span className="font-semibold text-slate-900">合計請求額</span>
                            <span className="tabular-nums font-bold text-slate-900">{Number(inv.amount || 0).toLocaleString("ja-JP")}円</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
            <div
              className="border-t border-slate-200 p-3 bg-white sticky bottom-0"
              style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
            >
              <button
                type="button"
                disabled={approvingInvoiceId === previewInvoiceId}
                onClick={() => previewInvoiceId && void handleApproveInvoice(previewInvoiceId)}
                className="w-full py-2 rounded-md bg-slate-800 text-white text-sm font-medium disabled:opacity-50"
              >
                {approvingInvoiceId === previewInvoiceId ? "承認中..." : "承認する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
