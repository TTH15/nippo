"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
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
    </div>
  );
}
