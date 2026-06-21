"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";

export interface Expense {
  id: string;
  name: string;
  amount: number;
}

interface ExpenseSectionProps {
  expenses: Expense[];
  onAddExpense: (name: string, amount: number) => Promise<void>;
  onDeleteExpense: (id: string) => void;
  submitting?: boolean;
  error?: string | null;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("ja-JP");
}

export function ExpenseSection({
  expenses,
  onAddExpense,
  onDeleteExpense,
  submitting = false,
  error = null,
}: ExpenseSectionProps) {
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(expenseAmount.replace(/\D/g, ""), 10);
    if (!expenseName.trim() || isNaN(amount) || amount <= 0) return;
    try {
      await onAddExpense(expenseName.trim(), amount);
      setExpenseName("");
      setExpenseAmount("");
    } catch {
      // エラーは親で設定され error prop で表示
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-bold text-slate-900">自由経費</h3>
        <span className="text-xs text-slate-500">ⓘ 個人用</span>
      </div>

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto,auto] gap-3">
          <div>
            <label htmlFor="expenseName" className="block text-sm text-slate-600 mb-1">
              経費名
            </label>
            <input
              id="expenseName"
              type="text"
              placeholder="例: ガソリン代"
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="expenseAmount" className="block text-sm text-slate-600 mb-1">
              金額（円）
            </label>
            <input
              id="expenseAmount"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value.replace(/[^0-9]/g, ""))}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting || !expenseName.trim() || !expenseAmount}
              className="w-full sm:w-auto px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={18} />
              {submitting ? "追加中..." : "追加"}
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
      </form>

      {expenses.length > 0 ? (
        <div className="space-y-2">
          {expenses.map((expense) => (
            <div
              key={expense.id}
              className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <span className="text-slate-800">{expense.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-orange-500 font-semibold">
                  -{formatCurrency(expense.amount)}円
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteExpense(expense.id)}
                  className="text-red-500 hover:text-red-700 transition-colors p-1"
                  aria-label="削除"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400 text-center py-4">
          経費を追加してください
        </p>
      )}
    </div>
  );
}
