"use client";

interface FixedExpense {
  name: string;
  amount: number;
}

interface FixedExpenseSectionProps {
  expenses: FixedExpense[];
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("ja-JP");
}

export function FixedExpenseSection({ expenses }: FixedExpenseSectionProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-bold text-slate-900">諸経費</h3>
        <span className="text-xs text-slate-500">ⓘ 管理者設定</span>
      </div>

      {expenses.length > 0 ? (
        <div className="space-y-2">
          {expenses.map((expense, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
            >
              <span className="text-slate-800">{expense.name}</span>
              <span className="text-orange-500 font-semibold">
                -{formatCurrency(expense.amount)}円
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400 text-center py-4">
          固定経費はありません
        </p>
      )}
    </div>
  );
}
