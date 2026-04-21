"use client";

import { useEffect, useState, useCallback } from "react";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { ExpenseSection } from "@/lib/components/ExpenseSection";
import { FixedExpenseSection } from "@/lib/components/FixedExpenseSection";
import { PaymentSummary } from "@/lib/components/PaymentSummary";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";

type RewardLogDetail = {
  log_date: string;
  type_name: string;
  content: string;
  amount: number;
};

type FixedExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

type OptionalExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

type RewardsSummary = {
  month: string;
  startDate: string;
  endDate: string;
  incomeLog: number;
  variableDeductions: number;
  fixedDeductions: number;
  optionalDeductions?: number;
  net: number;
  logDetails: RewardLogDetail[];
  dailyIncomeDetails?: RewardLogDetail[];
  fixedDetails: FixedExpenseDetail[];
  optionalDetails?: OptionalExpenseDetail[];
};

type MyInvoice = {
  id: string;
  month: string;
  issueDate: string;
  amount: number;
  status: "draft" | "pending_approval" | "approved" | "paid";
  invoiceNo: string;
  payload: any;
};

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function formatLogLine(log: RewardLogDetail): string {
  const [y, m, d] = log.log_date.split("-").map(Number);
  const label = log.content || log.type_name || "—";
  const amount = log.amount >= 0 ? `${log.amount.toLocaleString("ja-JP")}円` : `-${Math.abs(log.amount).toLocaleString("ja-JP")}円`;
  return `${m}月${d}日 ${label} ${amount}`;
}

/** 日報ベースの日別報酬と手動ログを日付順にまとめた一覧 */
function mergedDetails(rewards: RewardsSummary): RewardLogDetail[] {
  const daily = rewards.dailyIncomeDetails ?? [];
  const manual = rewards.logDetails ?? [];
  return [...daily, ...manual].sort((a, b) => a.log_date.localeCompare(b.log_date));
}

export default function MeRewardsPage() {
  const [rewardMonth, setRewardMonth] = useState(() => currentYearMonth());
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [optionalSubmitting, setOptionalSubmitting] = useState(false);
  const [optionalError, setOptionalError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [invoices, setInvoices] = useState<MyInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [approvingInvoiceId, setApprovingInvoiceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"rewards" | "invoices">("rewards");
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);

  const monthStr = `${rewardMonth.year}-${String(rewardMonth.month).padStart(2, "0")}`;

  const loadRewards = useCallback(() => {
    setRewardsLoading(true);
    setRewardsError(null);
    apiFetch<RewardsSummary>(`/api/me/rewards?month=${monthStr}`)
      .then((d) => setRewards(d))
      .catch((e: unknown) => {
        console.error(e);
        setRewardsError("報酬サマリの取得に失敗しました");
      })
      .finally(() => setRewardsLoading(false));
  }, [monthStr]);

  useEffect(() => {
    loadRewards();
  }, [loadRewards]);

  useEffect(() => {
    setInvoicesLoading(true);
    apiFetch<{ invoices: MyInvoice[] }>(`/api/me/invoices`)
      .then((res) => {
        const pendingOnly = (res.invoices ?? []).filter((inv) => inv.status === "pending_approval");
        setInvoices(pendingOnly);
      })
      .catch((e) => {
        console.error(e);
        setInvoices([]);
      })
      .finally(() => setInvoicesLoading(false));
  }, []);

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
      const res = await apiFetch<{ invoices: MyInvoice[] }>(`/api/me/invoices`);
      setInvoices((res.invoices ?? []).filter((inv) => inv.status === "pending_approval"));
    } catch (e) {
      console.error(e);
    } finally {
      setApprovingInvoiceId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-lg font-bold text-slate-900 mb-4">報酬</h1>

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
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab("rewards")}
              className={`px-3 py-1.5 text-sm rounded-md ${activeTab === "rewards" ? "bg-slate-800 text-white" : "text-slate-600"}`}
            >
              報酬明細
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("invoices")}
              className={`px-3 py-1.5 text-sm rounded-md ${activeTab === "invoices" ? "bg-slate-800 text-white" : "text-slate-600"}`}
            >
              請求書確認
            </button>
          </div>

          {activeTab === "rewards" ? (
            <>
              <PaymentSummary
                income={rewards.incomeLog}
                companyExpenses={rewards.fixedDeductions}
                customExpenses={rewards.optionalDeductions ?? 0}
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
                          <span className="text-slate-600 font-medium">
                            {(() => {
                              const [y, m, d] = l.log_date.split("-").map(Number);
                              return `${m}月${d}日`;
                            })()}
                          </span>
                          <span className="text-slate-800">{l.content || l.type_name || "—"}</span>
                          <span className="text-slate-900 font-semibold">
                            {l.amount >= 0 ? `${l.amount.toLocaleString("ja-JP")}円` : `-${Math.abs(l.amount).toLocaleString("ja-JP")}円`}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
              <p className="text-xs text-slate-600">
                承認待ちの請求書のみ表示しています。内容を確認して承認してください。
              </p>
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
                      {inv.amount.toLocaleString("ja-JP")}円
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewInvoiceId(inv.id)}
                        className="rounded-md border border-slate-300 text-slate-700 text-sm py-2"
                      >
                        プレビューを見る
                      </button>
                      <button
                        type="button"
                        disabled={approvingInvoiceId === inv.id}
                        onClick={() => void handleApproveInvoice(inv.id)}
                        className="rounded-md bg-slate-800 text-white text-sm py-2 disabled:opacity-50"
                      >
                        {approvingInvoiceId === inv.id ? "承認中..." : "内容を確認して承認"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

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

      {previewInvoiceId && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl h-[90vh] bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">請求書プレビュー</div>
              <button type="button" onClick={() => setPreviewInvoiceId(null)} className="text-sm text-slate-500">
                閉じる
              </button>
            </div>
            <iframe
              src={`/invoice/index.html?invoiceId=${encodeURIComponent(previewInvoiceId)}&readonly=1&scope=me`}
              className="w-full border-0"
              style={{ height: "calc(90vh - 49px)" }}
              title="請求書プレビュー"
            />
          </div>
        </div>
      )}
    </div>
  );
}
