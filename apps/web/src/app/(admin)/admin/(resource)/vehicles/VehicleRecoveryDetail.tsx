"use client";

import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";

type RecoveryMonth = {
  ym: string;
  baseLease: number;
  dailyAuto: number;
  insurance: number;
  monthlyRecovery: number;
  cumulative: number;
  kind: "carryover" | "auto" | "manual";
  entryId?: string;
  note?: string | null;
};
type Recovery = {
  vehicleId: string;
  purchaseCost: number;
  carryover: number;
  baseLease: number;
  insurance: number;
  startMonth: string;
  months: RecoveryMonth[];
  recovered: number;
  remaining: number;
};

const fmt = (n: number) => n.toLocaleString("ja-JP");
const ymLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
};

export function VehicleRecoveryDetail({
  vehicleId,
  title,
  canWrite,
  onClose,
  onRecoveredChange,
}: {
  vehicleId: string;
  title: string;
  canWrite: boolean;
  onClose: () => void;
  /** 親（一覧）の回収済み額を同期するため */
  onRecoveredChange?: (recovered: number, remaining: number) => void;
}) {
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 手動行の追加フォーム
  const [adding, setAdding] = useState(false);
  const [newYm, setNewYm] = useState("");
  const [newLease, setNewLease] = useState("");
  const [newInsurance, setNewInsurance] = useState("");
  const [newNote, setNewNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ recovery: Recovery }>(`/api/admin/vehicles/${vehicleId}/recovery`);
      setRecovery(res.recovery);
      onRecoveredChange?.(res.recovery.recovered, res.recovery.remaining);
    } catch (e) {
      setError(e instanceof Error ? e.message : "回収情報の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [vehicleId, onRecoveredChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const addManual = async () => {
    if (!canWrite) return;
    const ym = /^\d{4}-\d{2}$/.test(newYm) ? newYm : "";
    if (!ym) {
      setError("対象月を選択してください");
      return;
    }
    setAdding(true);
    try {
      await apiFetch(`/api/admin/vehicles/${vehicleId}/recovery-entries`, {
        method: "POST",
        body: JSON.stringify({
          ym,
          lease: parseInt(newLease, 10) || 0,
          insurance: parseInt(newInsurance, 10) || 0,
          note: newNote.trim() || null,
        }),
      });
      setNewYm("");
      setNewLease("");
      setNewInsurance("");
      setNewNote("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "手動行の追加に失敗しました");
    } finally {
      setAdding(false);
    }
  };

  const deleteManual = async (entryId: string) => {
    if (!canWrite) return;
    try {
      await apiFetch(`/api/admin/vehicles/${vehicleId}/recovery-entries?entry_id=${encodeURIComponent(entryId)}`, {
        method: "DELETE",
      });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "手動行の削除に失敗しました");
    }
  };

  const progress =
    recovery && recovery.purchaseCost > 0
      ? Math.min(100, (recovery.recovered / recovery.purchaseCost) * 100)
      : 0;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">初期費用回収の詳細</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 transition-colors text-sm"
        >
          閉じる
        </button>
      </div>

      <div className="text-sm text-slate-700 mb-3">
        <div className="font-medium mb-1">{title}</div>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mb-3">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">読み込み中…</p>
      ) : recovery ? (
        <>
          {/* サマリ */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <SummaryCell label="初期費用" value={`${fmt(recovery.purchaseCost)}円`} />
            <SummaryCell label="回収済み" value={`${fmt(recovery.recovered)}円`} accent="text-emerald-600" />
            <SummaryCell label="残り" value={`${fmt(recovery.remaining)}円`} accent="text-orange-600" />
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
            <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
          </div>

          {/* 手動行の追加 */}
          {canWrite && (
            <div className="flex flex-wrap items-end gap-2 mb-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">対象月</label>
                <MonthYearPicker
                  value={
                    /^\d{4}-\d{2}/.test(newYm)
                      ? { year: Number(newYm.slice(0, 4)), month: Number(newYm.slice(5, 7)) }
                      : undefined
                  }
                  onChange={({ year, month }) => setNewYm(`${year}-${String(month).padStart(2, "0")}`)}
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">リース代</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newLease}
                  onChange={(e) => setNewLease(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className="w-24 px-2 py-1.5 text-xs text-right border border-slate-200 rounded tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">保険料</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newInsurance}
                  onChange={(e) => setNewInsurance(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className="w-24 px-2 py-1.5 text-xs text-right border border-slate-200 rounded tabular-nums"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[11px] text-slate-500 mb-1">メモ（任意）</label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="例: 一括入金"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                />
              </div>
              <button
                type="button"
                onClick={() => void addManual()}
                disabled={adding}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                行を追加
              </button>
            </div>
          )}

          {/* 月次テーブル */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="min-w-[760px] w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-slate-600">月</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right text-slate-600">リース代</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right text-slate-600">日額リース</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right text-slate-600">保険料</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right text-slate-600">月回収額</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right text-slate-600">累計回収額</th>
                    <th className="px-2 py-2 w-12 text-center text-slate-600"></th>
                  </tr>
                </thead>
                <tbody>
                  {recovery.months.map((m, idx) => (
                    <tr
                      key={`${m.ym}-${m.kind}-${m.entryId ?? idx}`}
                      className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                    >
                      <td className="px-3 py-1.5 text-left text-slate-700 whitespace-nowrap">
                        {m.kind === "carryover" ? (
                          <span className="inline-flex items-center gap-1">
                            繰越
                            <span className="text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500">移行</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {ymLabel(m.ym)}
                            {m.kind === "manual" && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700">手動</span>
                            )}
                          </span>
                        )}
                        {m.note && <span className="block text-[10px] text-slate-400">{m.note}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                        {m.kind === "carryover" ? "—" : `${fmt(m.baseLease)}円`}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                        {m.dailyAuto > 0 ? `+${fmt(m.dailyAuto)}円` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                        {m.kind === "carryover" ? "—" : `${fmt(m.insurance)}円`}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-800 font-medium">
                        {fmt(m.monthlyRecovery)}円
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{fmt(m.cumulative)}円</td>
                      <td className="px-2 py-1.5 text-center">
                        {m.kind === "manual" && m.entryId && canWrite && (
                          <button
                            type="button"
                            title="この手動行を削除"
                            onClick={() => void deleteManual(m.entryId!)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recovery.months.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                        回収開始月を車両編集で設定すると、各月が自動表示されます。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function SummaryCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${accent ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}
