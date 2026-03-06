"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Nav } from "@/lib/components/Nav";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
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
  fixedDetails: FixedExpenseDetail[];
  optionalDetails?: OptionalExpenseDetail[];
};

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export default function MeRewardsPage() {
  const [rewardMonth, setRewardMonth] = useState(() => currentYearMonth());
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [optionalName, setOptionalName] = useState("");
  const [optionalAmount, setOptionalAmount] = useState("");
  const [optionalSubmitting, setOptionalSubmitting] = useState(false);
  const [optionalError, setOptionalError] = useState<string | null>(null);

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

  const handleAddOptional = async (e: React.FormEvent) => {
    e.preventDefault();
    setOptionalError(null);
    if (!optionalName.trim()) {
      setOptionalError("経費名を入力してください");
      return;
    }
    const amountNum = Number(optionalAmount.replace(/\D/g, ""));
    if (Number.isNaN(amountNum) || amountNum < 0) {
      setOptionalError("金額を0以上の数値で入力してください");
      return;
    }
    setOptionalSubmitting(true);
    try {
      await apiFetch("/api/me/optional-expenses", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, name: optionalName.trim(), amount: amountNum }),
      });
      setOptionalName("");
      setOptionalAmount("");
      loadRewards();
    } catch (err: unknown) {
      setOptionalError(err instanceof Error ? err.message : "追加に失敗しました");
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
    <>
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-4">
          <Link href="/me" className="text-sm text-slate-600 hover:text-slate-900">
            ← マイページに戻る
          </Link>
        </div>
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
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">
                今月の暫定報酬（{rewards.startDate}〜{rewards.endDate}）
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {formatYen(rewards.net)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">収入</div>
                  <div className="mt-0.5 font-mono text-slate-900">
                    {formatYen(rewards.incomeLog)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">変動控除</div>
                  <div className="mt-0.5 font-mono text-orange-600">
                    {formatYen(rewards.variableDeductions)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">固定控除（管理者設定）</div>
                  <div className="mt-0.5 font-mono text-orange-600">
                    {formatYen(-rewards.fixedDeductions)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">自由経費（自分で入力）</div>
                  <div className="mt-0.5 font-mono text-orange-600">
                    {formatYen(-(rewards.optionalDeductions ?? 0))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-2">ログ明細</h3>
                {rewards.logDetails.length === 0 ? (
                  <p className="text-xs text-slate-500">この月のログ明細はありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="py-1.5 px-2 text-left font-medium text-slate-600">日付</th>
                          <th className="py-1.5 px-2 text-left font-medium text-slate-600">種別</th>
                          <th className="py-1.5 px-2 text-left font-medium text-slate-600">内容</th>
                          <th className="py-1.5 px-2 text-right font-medium text-slate-600">金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rewards.logDetails.map((l, idx) => (
                          <tr
                            key={`${l.log_date}-${idx}`}
                            className="border-b border-slate-100 last:border-b-0"
                          >
                            <td className="py-1.5 px-2 whitespace-nowrap">{l.log_date}</td>
                            <td className="py-1.5 px-2 whitespace-nowrap text-slate-700">
                              {l.type_name}
                            </td>
                            <td className="py-1.5 px-2 text-slate-700">{l.content}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">
                              <span
                                className={
                                  l.amount >= 0 ? "text-slate-900" : "text-orange-600"
                                }
                              >
                                {formatYen(l.amount)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-2">
                  固定経費（管理者設定）
                </h3>
                <p className="text-xs text-slate-500 mb-2">
                  事務手数料・リース代などは管理者が登録しています。編集はできません。
                </p>
                {rewards.fixedDetails.length === 0 ? (
                  <p className="text-xs text-slate-500">この月に有効な固定経費はありません</p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-700">
                    {rewards.fixedDetails.map((f) => (
                      <li key={f.id} className="flex items-center justify-between">
                        <span>{f.name}</span>
                        <span className="font-mono text-orange-600">
                          {formatYen(-f.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-2">自由経費</h3>
                <p className="text-xs text-slate-500 mb-3">
                  ガソリン代など、ご自身で計算に含めたい経費を追加できます。管理者には表示されません。
                </p>
                <form onSubmit={handleAddOptional} className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-xs font-medium text-slate-600 mb-1">経費名</label>
                    <input
                      type="text"
                      value={optionalName}
                      onChange={(e) => setOptionalName(e.target.value)}
                      placeholder="例: ガソリン代"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-slate-600 mb-1">金額（円）</label>
                    <input
                      type="number"
                      min={0}
                      value={optionalAmount}
                      onChange={(e) => setOptionalAmount(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={optionalSubmitting}
                    className="px-3 py-2 text-sm bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
                  >
                    {optionalSubmitting ? "追加中..." : "追加"}
                  </button>
                </form>
                {optionalError && (
                  <p className="text-xs text-red-600 mb-2">{optionalError}</p>
                )}
                {(rewards.optionalDetails ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">登録された自由経費はありません</p>
                ) : (
                  <ul className="space-y-2 text-xs text-slate-700">
                    {(rewards.optionalDetails ?? []).map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-b-0"
                      >
                        <span>{o.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-orange-600">
                            {formatYen(-o.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteOptional(o.id)}
                            className="text-slate-400 hover:text-red-600 text-[11px]"
                          >
                            削除
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
