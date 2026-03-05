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
    { id: 1, name: "", amount: "", repeat: false },
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
    setDraftExpenses([{ id: 1, name: "", amount: "", repeat: false }]);
    setSaveError(null);
  }, [modalDriver, monthStr]);

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
        setSaveError("月額は1円以上の数値で入力してください");
        return;
      }
    }

    setSaving(true);
    try {
      await Promise.all(
        filled.map((d) => {
          const amountNum = Number(d.amount.replace(/\D/g, ""));
          if (d.repeat) {
            return apiFetch("/api/admin/driver-expenses", {
              method: "POST",
              body: JSON.stringify({
                driver_id: modalDriver.driverId,
                name: d.name.trim(),
                amount: amountNum,
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
              amount: amountNum,
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
      setDraftExpenses([{ id: 1, name: "", amount: "", repeat: false }]);
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
              <div className="flex items-center justify-between mb-2">
                {canWrite && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraftExpenses((rows) => {
                        const nextId = rows.length
                          ? Math.max(...rows.map((r) => r.id)) + 1
                          : 1;
                        return [...rows, { id: nextId, name: "", amount: "", repeat: false }];
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-sm font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                    title="行を追加"
                  >
                    <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                  </button>
                )}
              </div>
              {canWrite && (
                <div className="space-y-2 mb-3">
                  {draftExpenses.map((d, index) => (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <div className="flex-1 min-w-[100px]">
                        {index === 0 && (
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            経費名
                          </label>
                        )}
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
                          placeholder="例: リース代・臨時研修費"
                          className="w-full mr-2 px-3 py-2 text-sm border-0 border-b border-transparent focus:border-slate-500 focus:outline-none bg-transparent"
                        />
                      </div>
                      <div className="w-28">
                        {index === 0 && (
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            月額（円）
                          </label>
                        )}
                        <input
                          type="number"
                          min={1}
                          value={d.amount}
                          onChange={(e) =>
                            setDraftExpenses((rows) =>
                              rows.map((r) =>
                                r.id === d.id
                                  ? { ...r, amount: e.target.value.replace(/[^0-9]/g, "") }
                                  : r,
                              ),
                            )
                          }
                          className="w-full px-3 py-2 text-sm border-0 border-b border-transparent focus:border-slate-500 focus:outline-none bg-transparent text-left"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={d.repeat}
                          onClick={() =>
                            setDraftExpenses((rows) =>
                              rows.map((r) =>
                                r.id === d.id ? { ...r, repeat: !r.repeat } : r,
                              ),
                            )
                          }
                          title={d.repeat ? "翌月以降も継続（ON）" : "当月のみ（OFF）"}
                          className={`flex items-center font-bold justify-center w-9 h-9 rounded border transition-colors ${d.repeat
                            ? "text-white border-green-600 bg-green-600"
                            : "text-slate-400 border-slate-400 bg-slate-50"
                            }`}
                        >
                          <FontAwesomeIcon icon={faRepeat} className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() =>
                            setDraftExpenses((rows) =>
                              rows.length === 1
                                ? [{ id: rows[0].id, name: "", amount: "", repeat: false }]
                                : rows.filter((r) => r.id !== d.id),
                            )
                          }
                          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-600"
                          title="行を削除"
                        >
                          <FontAwesomeIcon icon={faTrash} className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}
              {fixedLoading || adHocLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : fixedExpenses.length === 0 && adHocExpenses.length === 0 ? (
                <p className="text-xs text-slate-500">登録されている経費はありません</p>
              ) : (
                <ul className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2 text-xs text-slate-700">
                  {fixedExpenses.map((f) => {
                    const fromLabel = f.valid_from ? String(f.valid_from).slice(0, 7) : "-";
                    const toLabel = f.valid_to ? String(f.valid_to).slice(0, 7) : "継続";
                    return (
                      <li key={`fixed-${f.id}`} className="flex justify-between items-center">
                        <span>{f.name}（{fromLabel}〜{toLabel}）</span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-orange-600">{formatYen(-f.amount)}</span>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => handleDeleteFixed(f.id)}
                              className="text-slate-400 hover:text-red-600 text-[11px]"
                            >
                              削除
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {adHocExpenses.map((o) => (
                    <li key={`adhoc-${o.id}`} className="flex justify-between items-center">
                      <span>{o.name}（当月のみ）</span>
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
