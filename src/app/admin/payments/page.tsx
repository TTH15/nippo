"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";

type DriverPaymentRow = {
  driverId: string;
  driverName: string;
  displayName: string | null;
  incomeLog: number;
  variableDeductions: number;
  fixedDeductions: number;
  adHocDeductions: number;
  net: number;
};

type FixedExpense = {
  id: string;
  name: string;
  amount: number;
  valid_from: string;
  valid_to: string | null;
};

type AdHocExpense = {
  id: string;
  name: string;
  amount: number;
};

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export default function PaymentsPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [yearMonth, setYearMonth] = useState(() => currentYearMonth());
  const [rows, setRows] = useState<DriverPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalDriver, setModalDriver] = useState<DriverPaymentRow | null>(null);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [fixedLoading, setFixedLoading] = useState(false);
  const [adHocExpenses, setAdHocExpenses] = useState<AdHocExpense[]>([]);
  const [adHocLoading, setAdHocLoading] = useState(false);
  const [adHocName, setAdHocName] = useState("");
  const [adHocAmount, setAdHocAmount] = useState("");
  const [adHocSubmitting, setAdHocSubmitting] = useState(false);
  const [adHocError, setAdHocError] = useState<string | null>(null);

  const monthStr = `${yearMonth.year}-${String(yearMonth.month).padStart(2, "0")}`;

  const loadPayments = useCallback(() => {
    setLoading(true);
    apiFetch<{ month: string; rows: DriverPaymentRow[] }>(`/api/admin/payments?month=${monthStr}`)
      .then((res) => setRows(res.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [monthStr]);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    if (!modalDriver) return;
    setFixedLoading(true);
    setAdHocLoading(true);
    apiFetch<{ expenses: FixedExpense[] }>(`/api/admin/driver-expenses?driver_id=${modalDriver.driverId}`)
      .then((res) => setFixedExpenses(res.expenses ?? []))
      .catch(() => setFixedExpenses([]))
      .finally(() => setFixedLoading(false));
    apiFetch<{ expenses: AdHocExpense[] }>(
      `/api/admin/driver-ad-hoc-expenses?driver_id=${modalDriver.driverId}&month=${monthStr}`
    )
      .then((res) => setAdHocExpenses(res.expenses ?? []))
      .catch(() => setAdHocExpenses([]))
      .finally(() => setAdHocLoading(false));
    setAdHocName("");
    setAdHocAmount("");
    setAdHocError(null);
  }, [modalDriver, monthStr]);

  const openModal = (row: DriverPaymentRow) => {
    setModalDriver(row);
  };

  const closeModal = () => {
    setModalDriver(null);
  };

  const handleAddAdHoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalDriver || !canWrite) return;
    setAdHocError(null);
    if (!adHocName.trim()) {
      setAdHocError("経費名を入力してください");
      return;
    }
    const amountNum = Number(adHocAmount.replace(/\D/g, ""));
    if (Number.isNaN(amountNum) || amountNum < 0) {
      setAdHocError("金額を0以上の数値で入力してください");
      return;
    }
    setAdHocSubmitting(true);
    try {
      await apiFetch("/api/admin/driver-ad-hoc-expenses", {
        method: "POST",
        body: JSON.stringify({
          driver_id: modalDriver.driverId,
          month: monthStr,
          name: adHocName.trim(),
          amount: amountNum,
        }),
      });
      setAdHocName("");
      setAdHocAmount("");
      const res = await apiFetch<{ expenses: AdHocExpense[] }>(
        `/api/admin/driver-ad-hoc-expenses?driver_id=${modalDriver.driverId}&month=${monthStr}`
      );
      setAdHocExpenses(res.expenses ?? []);
      loadPayments();
    } catch (err: unknown) {
      setAdHocError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setAdHocSubmitting(false);
    }
  };

  const handleDeleteAdHoc = async (id: string) => {
    if (!modalDriver || !canWrite) return;
    try {
      await apiFetch(`/api/admin/driver-ad-hoc-expenses/${id}`, { method: "DELETE" });
      const res = await apiFetch<{ expenses: AdHocExpense[] }>(
        `/api/admin/driver-ad-hoc-expenses?driver_id=${modalDriver.driverId}&month=${monthStr}`
      );
      setAdHocExpenses(res.expenses ?? []);
      loadPayments();
    } catch (e) {
      console.error(e);
    }
  };

  const isCurrentMonth =
    yearMonth.year === new Date().getFullYear() && yearMonth.month === new Date().getMonth() + 1;

  return (
    <AdminLayout>
      <div className="w-full">
        <h1 className="text-xl font-bold text-slate-900">ペイメント</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          ドライバーごとの月別報酬（今月は暫定）。固定経費はドライバー管理で、臨時経費はここで登録できます。
        </p>

        <div className="flex items-center gap-4 mt-6 mb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setYearMonth((m) =>
                  m.month === 1 ? { year: m.year - 1, month: 12 } : { ...m, month: m.month - 1 }
                )
              }
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50"
            >
              ← 前月
            </button>
            <span className="text-sm font-medium text-slate-900 min-w-[100px]">
              {yearMonth.year}年 {yearMonth.month}月
              {isCurrentMonth && (
                <span className="ml-1 text-xs font-normal text-amber-600">（暫定）</span>
              )}
            </span>
            <button
              type="button"
              onClick={() =>
                setYearMonth((m) =>
                  m.month === 12 ? { year: m.year + 1, month: 1 } : { ...m, month: m.month + 1 }
                )
              }
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50"
            >
              翌月 →
            </button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2.5 px-4 text-left"><Skeleton className="h-4 w-16" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-14" /></th>
                </tr>
              </thead>
              <tbody>
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2.5 px-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-12" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">ドライバーが登録されていません</p>
        ) : (
          <div className="bg-white rounded border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2.5 px-4 text-left font-medium text-slate-600">名前</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">収入</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">変動控除</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">固定控除</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">臨時経費</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">暫定支払額</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.driverId}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                  >
                    <td className="py-2.5 px-4 font-medium text-slate-800">
                      {getDisplayName({ name: row.driverName, display_name: row.displayName })}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-slate-700">
                      {formatYen(row.incomeLog)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-orange-600">
                      {formatYen(row.variableDeductions)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-orange-600">
                      {formatYen(-row.fixedDeductions)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-orange-600">
                      {formatYen(-row.adHocDeductions)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">
                      {formatYen(row.net)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openModal(row)}
                        className="text-slate-600 hover:text-slate-900 text-xs font-medium"
                      >
                        経費
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 経費詳細モーダル */}
      {modalDriver && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              {getDisplayName({ name: modalDriver.driverName, display_name: modalDriver.displayName })} — {monthStr}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              収入 {formatYen(modalDriver.incomeLog)} − 変動 {formatYen(modalDriver.variableDeductions)} − 固定 {formatYen(modalDriver.fixedDeductions)} − 臨時 {formatYen(modalDriver.adHocDeductions)} ＝ 暫定 {formatYen(modalDriver.net)}
            </p>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">固定経費（管理者設定）</h3>
                <p className="text-xs text-slate-500 mb-2">
                  リース代・事務手数料など。編集は
                  <Link href="/admin/users" className="text-slate-700 underline ml-1">
                    ドライバー管理
                  </Link>
                  の該当ドライバー編集から行ってください。
                </p>
                {fixedLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : fixedExpenses.length === 0 ? (
                  <p className="text-xs text-slate-500">登録されている固定経費はありません</p>
                ) : (
                  <ul className="bg-slate-50 border border-slate-200 rounded p-3 space-y-1 text-xs text-slate-700">
                    {fixedExpenses.map((f) => {
                      const fromLabel = f.valid_from ? String(f.valid_from).slice(0, 7) : "-";
                      const toLabel = f.valid_to ? String(f.valid_to).slice(0, 7) : "継続";
                      return (
                        <li key={f.id} className="flex justify-between">
                          <span>{f.name}（{fromLabel}〜{toLabel}）</span>
                          <span className="font-mono text-orange-600">{formatYen(-f.amount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">臨時経費</h3>
                <p className="text-xs text-slate-500 mb-2">
                  当月限りの経費を追加できます。
                </p>
                {canWrite && (
                  <form onSubmit={handleAddAdHoc} className="flex flex-wrap items-end gap-2 mb-3">
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-xs font-medium text-slate-600 mb-1">経費名</label>
                      <input
                        type="text"
                        value={adHocName}
                        onChange={(e) => setAdHocName(e.target.value)}
                        placeholder="例: 臨時研修費"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-xs font-medium text-slate-600 mb-1">金額（円）</label>
                      <input
                        type="number"
                        min={0}
                        value={adHocAmount}
                        onChange={(e) => setAdHocAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={adHocSubmitting}
                      className="px-3 py-2 text-sm bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
                    >
                      {adHocSubmitting ? "追加中..." : "追加"}
                    </button>
                  </form>
                )}
                {adHocError && <p className="text-xs text-red-600 mb-2">{adHocError}</p>}
                {adHocLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : adHocExpenses.length === 0 ? (
                  <p className="text-xs text-slate-500">この月の臨時経費はありません</p>
                ) : (
                  <ul className="space-y-2 text-xs text-slate-700">
                    {adHocExpenses.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-b-0"
                      >
                        <span>{o.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-orange-600">{formatYen(-o.amount)}</span>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAdHoc(o.id)}
                              className="text-slate-400 hover:text-red-600 text-[11px]"
                            >
                              削除
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 text-sm bg-slate-200 text-slate-800 rounded hover:bg-slate-300"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
