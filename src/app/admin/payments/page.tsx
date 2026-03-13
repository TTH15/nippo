"use client";

import { useEffect, useState, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRepeat, faPenToSquare, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";

type DriverPaymentRow = {
  driverId: string;
  driverName: string;
  displayName: string | null;
  incomeLog: number;
  yamatoIncome: number;
  amazonIncome: number;
  otherIncome: number;
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

type DraftExpense = {
  id: number;
  name: string;
  amount: string;
  sign: "+" | "-";
  repeat: boolean;
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
  const [draftExpenses, setDraftExpenses] = useState<DraftExpense[]>([
    { id: 1, name: "", amount: "", sign: "-", repeat: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const monthStr = `${yearMonth.year}-${String(yearMonth.month).padStart(2, "0")}`;

  const monthStartDate = `${monthStr}-01`;
  const lastDayOfMonth = new Date(yearMonth.year, yearMonth.month, 0).getDate();
  const monthEndDate = `${monthStr}-${String(lastDayOfMonth).padStart(2, "0")}`;

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
    setDraftExpenses([{ id: 1, name: "", amount: "", sign: "-", repeat: false }]);
    setSaveError(null);
  }, [modalDriver, monthStr]);

  const fmtSignedYen = (amount: number) => {
    const n = Number(amount) || 0;
    const sign = n >= 0 ? "−" : "+";
    return `${sign}${Math.abs(n).toLocaleString("ja-JP")}円`;
  };

  const openModal = (row: DriverPaymentRow) => {
    setModalDriver(row);
  };

  const closeModal = () => {
    setModalDriver(null);
  };

  const handleSave = async () => {
    if (!modalDriver || !canWrite) return;
    setSaveError(null);

    const filled = draftExpenses.filter(
      (d) => d.name.trim() !== "" || d.amount.trim() !== "",
    );
    if (filled.length === 0) {
      setSaveError("経費を入力してください");
      return;
    }

    for (const d of filled) {
      if (!d.name.trim()) {
        setSaveError("経費名を入力してください");
        return;
      }
      const amountNum = Number(d.amount.replace(/\D/g, ""));
      if (Number.isNaN(amountNum) || amountNum <= 0) {
        setSaveError("金額は1円以上の数値で入力してください");
        return;
      }
    }

    setSaving(true);
    try {
      await Promise.all(
        filled.map((d) => {
          const amountNum = Number(d.amount.replace(/\D/g, ""));
          const signedAmount = (d.sign === "+" ? -1 : 1) * amountNum;
          if (d.repeat) {
            return apiFetch("/api/admin/driver-expenses", {
              method: "POST",
              body: JSON.stringify({
                driver_id: modalDriver.driverId,
                name: d.name.trim(),
                amount: signedAmount,
                valid_from: monthStartDate,
                valid_to: null,
              }),
            });
          }
          return apiFetch("/api/admin/driver-ad-hoc-expenses", {
            method: "POST",
            body: JSON.stringify({
              driver_id: modalDriver.driverId,
              month: monthStr,
              name: d.name.trim(),
              amount: signedAmount,
            }),
          });
        }),
      );

      const [fixedRes, adHocRes] = await Promise.all([
        apiFetch<{ expenses: FixedExpense[] }>(`/api/admin/driver-expenses?driver_id=${modalDriver.driverId}`),
        apiFetch<{ expenses: AdHocExpense[] }>(
          `/api/admin/driver-ad-hoc-expenses?driver_id=${modalDriver.driverId}&month=${monthStr}`
        ),
      ]);
      setFixedExpenses(fixedRes.expenses ?? []);
      setAdHocExpenses(adHocRes.expenses ?? []);
      setDraftExpenses([{ id: 1, name: "", amount: "", sign: "-", repeat: false }]);
      loadPayments();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
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

  const handleDeleteFixed = async (id: string) => {
    if (!modalDriver || !canWrite) return;
    try {
      await apiFetch(`/api/admin/driver-expenses/${id}`, { method: "DELETE" });
      const res = await apiFetch<{ expenses: FixedExpense[] }>(
        `/api/admin/driver-expenses?driver_id=${modalDriver.driverId}`
      );
      setFixedExpenses(res.expenses ?? []);
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
          ドライバーごとの月別報酬（今月は暫定）。固定経費・臨時経費はここから登録できます。
        </p>

        <div className="flex items-center gap-3 mt-6 mb-4">
          <MonthYearPicker
            value={yearMonth}
            onChange={setYearMonth}
            placeholder="年月を選択"
          />
          {isCurrentMonth && (
            <span className="text-sm font-medium text-amber-600">（暫定）</span>
          )}
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
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">支払額</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">報酬</th>
                  <th className="py-2.5 px-4 text-right text-xs font-medium text-slate-600">
                    控除計
                  </th>
                  <th className="py-2.5 px-4 text-right text-xs font-medium text-slate-600">
                    詳細
                  </th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const totalDeductions = row.fixedDeductions + row.adHocDeductions;
                  return (
                    <tr
                      key={row.driverId}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {getDisplayName({
                          name: row.driverName,
                          display_name: row.displayName,
                        })}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">
                        {formatYen(row.net)}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-slate-700">
                        {formatYen(row.incomeLog)}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-orange-600 text-xs">
                        {formatYen(totalDeductions)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[11px] leading-snug text-slate-500">
                        報酬: ヤマト {formatYen(row.yamatoIncome)}／Amazon{" "}
                        {formatYen(row.amazonIncome)}／その他{" "}
                        {formatYen(row.otherIncome)}
                        <br />
                        控除: 固定 {formatYen(-row.fixedDeductions)}／臨時{" "}
                        {formatYen(-row.adHocDeductions)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openModal(row)}
                          className="text-slate-600 hover:text-slate-900 text-xs font-medium"
                        >
                          <FontAwesomeIcon icon={faPenToSquare} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
              {getDisplayName({ name: modalDriver.driverName, display_name: modalDriver.displayName })} {yearMonth.year}年{yearMonth.month}月 経費
            </h2>
            <p className="text-xs text-slate-500 mb-1">
              収入 {formatYen(modalDriver.incomeLog)} − 固定 {formatYen(modalDriver.fixedDeductions)} − 臨時 {formatYen(modalDriver.adHocDeductions)} ＝ 暫定 {formatYen(modalDriver.net)}
            </p>
            <p className="text-xs text-slate-500 mb-4">
              報酬内訳: ヤマト {formatYen(modalDriver.yamatoIncome)}／Amazon {formatYen(modalDriver.amazonIncome)}／その他 {formatYen(modalDriver.otherIncome)}
            </p>

            <div>
              {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}
              {fixedLoading || adHocLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-slate-100">
                      <tr className="border-b border-slate-200">
                        <th className="py-2 px-3 text-left font-medium text-slate-600">
                          種別
                        </th>
                        <th className="py-2 px-3 text-center font-medium text-slate-600">
                          区分
                        </th>
                        <th className="py-2 px-3 text-left font-medium text-slate-600">
                          内容
                        </th>
                        <th className="py-2 px-3 text-left font-medium text-slate-600">
                          期間
                        </th>
                        <th className="py-2 px-3 text-right font-medium text-slate-600">
                          金額
                        </th>
                        {canWrite && (
                          <th className="py-2 px-3 text-center font-medium text-slate-600">
                            操作
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {fixedExpenses.map((f) => {
                        const fromLabel = f.valid_from ? String(f.valid_from).slice(0, 7) : "-";
                        const toLabel = f.valid_to ? String(f.valid_to).slice(0, 7) : "継続";
                        const isDeduction = f.amount >= 0;
                        return (
                          <tr key={`fixed-${f.id}`} className="border-t border-slate-200">
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                              固定
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold ${isDeduction
                                  ? "bg-orange-50 text-orange-700"
                                  : "bg-emerald-50 text-emerald-700"
                                  }`}
                              >
                                {isDeduction ? "−" : "＋"}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-800">
                              {f.name}
                            </td>
                            <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">
                              {fromLabel}〜{toLabel}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span
                                className={`font-mono tabular-nums ${isDeduction ? "text-orange-600" : "text-emerald-600"}`}
                              >
                                {fmtSignedYen(f.amount)}
                              </span>
                            </td>
                            {canWrite && (
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteFixed(f.id)}
                                  className="text-[11px] text-slate-400 hover:text-red-600"
                                >
                                  削除
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {adHocExpenses.map((o) => {
                        const isDeduction = o.amount >= 0;
                        return (
                          <tr key={`adhoc-${o.id}`} className="border-t border-slate-200">
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                              臨時
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold ${isDeduction
                                  ? "bg-orange-50 text-orange-700"
                                  : "bg-emerald-50 text-emerald-700"
                                  }`}
                              >
                                {isDeduction ? "−" : "＋"}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-800">
                              {o.name}
                            </td>
                            <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">
                              当月のみ
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span
                                className={`font-mono tabular-nums ${isDeduction ? "text-orange-600" : "text-emerald-600"}`}
                              >
                                {fmtSignedYen(o.amount)}
                              </span>
                            </td>
                            {canWrite && (
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAdHoc(o.id)}
                                  className="text-[11px] text-slate-400 hover:text-red-600"
                                >
                                  削除
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}

                      {canWrite &&
                        draftExpenses.map((d) => (
                          <tr key={`draft-${d.id}`} className="border-t border-slate-200 bg-white">
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftExpenses((rows) =>
                                    rows.map((r) =>
                                      r.id === d.id ? { ...r, repeat: !r.repeat } : r,
                                    ),
                                  )
                                }
                                className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-[11px] font-semibold border ${d.repeat
                                  ? "border-slate-800 text-slate-800"
                                  : "border-slate-300 text-slate-500"
                                  }`}
                                title={d.repeat ? "翌月以降も継続（固定経費として登録）" : "当月のみ（臨時経費として登録）"}
                              >
                                {d.repeat ? "固定" : "臨時"}
                              </button>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <div className="inline-flex rounded-md overflow-hidden border border-slate-200 h-8">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftExpenses((rows) =>
                                      rows.map((r) =>
                                        r.id === d.id ? { ...r, sign: "+" } : r,
                                      ),
                                    )
                                  }
                                  className={`px-3 text-[13px] font-semibold transition-colors ${d.sign === "+" ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                                  title="手当（支払額に加算）"
                                >
                                  ＋
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftExpenses((rows) =>
                                      rows.map((r) =>
                                        r.id === d.id ? { ...r, sign: "-" } : r,
                                      ),
                                    )
                                  }
                                  className={`px-3 text-[13px] font-semibold transition-colors ${d.sign === "-" ? "bg-orange-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                                  title="控除（支払額から減算）"
                                >
                                  −
                                </button>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={d.name}
                                onChange={(e) =>
                                  setDraftExpenses((rows) =>
                                    rows.map((r) =>
                                      r.id === d.id ? { ...r, name: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="例: リース代・特別手当"
                                className="w-full px-2 py-1.5 text-xs sm:text-sm border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                              />
                            </td>
                            <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">
                              {d.repeat ? "翌月以降も継続" : "当月のみ"}
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="number"
                                min={1}
                                value={d.amount}
                                onChange={(e) =>
                                  setDraftExpenses((rows) =>
                                    rows.map((r) =>
                                      r.id === d.id
                                        ? {
                                            ...r,
                                            amount: e.target.value.replace(/[^0-9]/g, ""),
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                className="w-full px-2 py-1.5 text-xs sm:text-sm border border-slate-200 rounded bg-white text-right focus:outline-none focus:ring-1 focus:ring-slate-400"
                              />
                            </td>
                            {canWrite && (
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftExpenses((rows) =>
                                      rows.length === 1
                                        ? [
                                            {
                                              id: rows[0].id,
                                              name: "",
                                              amount: "",
                                              sign: "-",
                                              repeat: false,
                                            },
                                          ]
                                        : rows.filter((r) => r.id !== d.id),
                                    )
                                  }
                                  className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-red-600"
                                  title="行を削除"
                                >
                                  <FontAwesomeIcon icon={faTrash} className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}

                      {fixedExpenses.length === 0 &&
                        adHocExpenses.length === 0 &&
                        (!canWrite || draftExpenses.length === 0 || (draftExpenses.length === 1 && !draftExpenses[0].name && !draftExpenses[0].amount)) && (
                          <tr>
                            <td
                              className="py-3 px-3 text-center text-xs text-slate-500"
                              colSpan={canWrite ? 6 : 5}
                            >
                              登録されている経費はありません
                            </td>
                          </tr>
                        )}

                      {canWrite && (
                        <tr className="border-t border-slate-200 bg-slate-100/60">
                          <td colSpan={canWrite ? 6 : 5} className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftExpenses((rows) => {
                                  const nextId = rows.length
                                    ? Math.max(...rows.map((r) => r.id)) + 1
                                    : 1;
                                  return [
                                    ...rows,
                                    {
                                      id: nextId,
                                      name: "",
                                      amount: "",
                                      sign: "-",
                                      repeat: false,
                                    },
                                  ];
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                            >
                              <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                              行を追加
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 text-sm bg-slate-200 text-slate-800 rounded hover:bg-slate-300"
              >
                閉じる
              </button>
              {canWrite && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
