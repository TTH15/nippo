"use client";

interface PaymentSummaryProps {
  income: number;
  companyExpenses: number;
  customExpenses: number;
  selectedDate: Date;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("ja-JP");
}

export function PaymentSummary({
  income,
  companyExpenses,
  customExpenses,
  selectedDate,
}: PaymentSummaryProps) {
  const total = income - companyExpenses - customExpenses;

  const now = new Date();
  const isCurrentMonth =
    selectedDate.getMonth() === now.getMonth() &&
    selectedDate.getFullYear() === now.getFullYear();

  return (
    <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
      <div className="mb-4">
        <p className="text-sm text-slate-600 mb-2">
          今月の{isCurrentMonth ? "暫定" : ""}報酬
        </p>
        <p className="text-4xl font-bold text-slate-900">
          {formatCurrency(total)}円
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <div>
          <p className="text-sm text-slate-600 mb-1">収入</p>
          <p className="text-lg font-semibold text-slate-900">
            {formatCurrency(income)}円
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-600 mb-1">諸経費</p>
          <p className="text-lg font-semibold text-orange-500">
            -{formatCurrency(companyExpenses)}円
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-sm text-slate-600 mb-1">自由経費</p>
          <p className="text-lg font-semibold text-orange-500">
            -{formatCurrency(customExpenses)}円
          </p>
        </div>
      </div>
    </div>
  );
}
