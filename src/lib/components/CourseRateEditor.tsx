"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Unit = {
  id: string;
  name: string;
  code: string | null;
  billing_type: "PER_PIECE" | "FIXED";
};
type UnitRate = {
  unit_id: string;
  revenue_per_unit: number;
  profit_per_unit: number;
  payout_per_unit: number;
};
type Fixed = { fixed_revenue: number; fixed_profit: number; fixed_payout: number };

type LoadResponse = {
  courseName: string;
  carrierId: string | null;
  units: Unit[];
  unitRates: UnitRate[];
  fixed: Fixed;
};

/**
 * 新モデルのコース課金エディタ。
 * 従量(course_unit_rates) を unit ごとに、固定(日当, course_fixed_rates) をコース単位で編集。
 * 両者は集計時に「加算」される（排他ではない）。保存時に旧 course_rates も同期される。
 */
export function CourseRateEditor({
  open,
  courseId,
  courseName,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  courseId: string | null;
  courseName: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [carrierMissing, setCarrierMissing] = useState(false);
  const [rates, setRates] = useState<Record<string, UnitRate>>({});
  const [fixed, setFixed] = useState<Fixed>({ fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 });

  useEffect(() => {
    if (!open || !courseId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<LoadResponse>(`/api/admin/course-billing?course_id=${courseId}`);
        if (cancelled) return;
        setCarrierMissing(!res.carrierId);
        setUnits(res.units ?? []);
        const map: Record<string, UnitRate> = {};
        (res.units ?? []).forEach((u) => {
          const found = (res.unitRates ?? []).find((r) => r.unit_id === u.id);
          map[u.id] = {
            unit_id: u.id,
            revenue_per_unit: found?.revenue_per_unit ?? 0,
            profit_per_unit: found?.profit_per_unit ?? 0,
            payout_per_unit: found?.payout_per_unit ?? 0,
          };
        });
        setRates(map);
        setFixed({
          fixed_revenue: res.fixed?.fixed_revenue ?? 0,
          fixed_profit: res.fixed?.fixed_profit ?? 0,
          fixed_payout: res.fixed?.fixed_payout ?? 0,
        });
      } catch (e) {
        onError(e instanceof Error ? e.message : "読み込みに失敗しました");
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !courseId) return null;

  function setRate(unitId: string, key: keyof Omit<UnitRate, "unit_id">, value: number) {
    setRates((prev) => ({ ...prev, [unitId]: { ...prev[unitId], [key]: value } }));
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/admin/course-billing", {
        method: "PUT",
        body: JSON.stringify({
          course_id: courseId,
          unitRates: Object.values(rates),
          fixed,
        }),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">単価設定 — {courseName}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">従量（個数×単価）と固定（日当）は加算されます。両方0なら計上なし。</p>
        </div>

        <div className="px-5 py-4 space-y-5 text-sm">
          {loading ? (
            <p className="text-slate-400 text-xs">読み込み中…</p>
          ) : (
            <>
              {carrierMissing && (
                <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
                  このコースにキャリアが設定されていません。従量unitは表示されません（固定のみ設定可）。
                  コース編集でキャリアを設定してください。
                </div>
              )}

              {/* 従量（unit別） */}
              {units.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">従量（型ごとの単価 / 個）</h3>
                  <div className="space-y-3">
                    {units.map((u) => (
                      <div key={u.id} className="rounded border border-slate-200 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-slate-800">{u.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            {u.billing_type === "FIXED" ? "固定型" : "従量型"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <NumField label="売上/個" value={rates[u.id]?.revenue_per_unit ?? 0} onChange={(v) => setRate(u.id, "revenue_per_unit", v)} />
                          <NumField label="利益/個" value={rates[u.id]?.profit_per_unit ?? 0} onChange={(v) => setRate(u.id, "profit_per_unit", v)} />
                          <NumField label="支払/個" value={rates[u.id]?.payout_per_unit ?? 0} onChange={(v) => setRate(u.id, "payout_per_unit", v)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 固定（日当） */}
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-2">固定（日当 / 1シフト）</h3>
                <div className="grid grid-cols-3 gap-2">
                  <NumField label="売上" value={fixed.fixed_revenue} onChange={(v) => setFixed((f) => ({ ...f, fixed_revenue: v }))} />
                  <NumField label="利益" value={fixed.fixed_profit} onChange={(v) => setFixed((f) => ({ ...f, fixed_profit: v }))} />
                  <NumField label="支払" value={fixed.fixed_payout} onChange={(v) => setFixed((f) => ({ ...f, fixed_payout: v }))} />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">混在コース（歩合＋日当）は従量と固定の両方を入力してください。</p>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">キャンセル</button>
          <button type="button" disabled={saving || loading} onClick={save} className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-700 disabled:opacity-50">
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 mb-1">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-2 py-1.5 border border-slate-300 rounded text-right"
      />
    </label>
  );
}
