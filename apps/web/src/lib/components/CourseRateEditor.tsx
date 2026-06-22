"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
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

export type CourseRateEditorHandle = {
  /**
   * 親モーダルの保存時に呼ぶ。course-billing を保存する。
   * 新規作成時はコース作成後に得た id を overrideCourseId で渡す。
   */
  save: (overrideCourseId?: string) => Promise<void>;
};

/**
 * コース課金（新モデル）の埋め込みフォーム。
 * 従量(course_unit_rates) を unit ごとに、固定(日当, course_fixed_rates) をコース単位で編集。
 * コース編集モーダルの右カラムに埋め込み、保存は ref 経由で親が呼ぶ。
 *
 * 既存コース: courseId を渡す（単価をロード）。
 * 新規作成:   courseId=null + carrierId を渡す（キャリア配下 unit を空単価でロード）。
 *             保存はコース作成後に save(newCourseId) で行う。
 */
export const CourseRateEditor = forwardRef<
  CourseRateEditorHandle,
  {
    courseId: string | null;
    carrierId?: string | null;
    onError: (msg: string) => void;
  }
>(function CourseRateEditor({ courseId, carrierId, onError }, ref) {
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [carrierMissing, setCarrierMissing] = useState(false);
  const [rates, setRates] = useState<Record<string, UnitRate>>({});
  const [fixed, setFixed] = useState<Fixed>({ fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 });

  // 作成モード（courseId 無し）でキャリア未選択なら、まだ何も読まない。
  const createModeNoCarrier = !courseId && !carrierId;

  useEffect(() => {
    if (createModeNoCarrier) {
      setUnits([]);
      setRates({});
      setFixed({ fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 });
      setCarrierMissing(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = courseId ? `course_id=${courseId}` : `carrier_id=${carrierId}`;
        const res = await apiFetch<LoadResponse>(`/api/admin/course-billing?${qs}`);
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
        onError(e instanceof Error ? e.message : "単価の読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, carrierId, createModeNoCarrier]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    ref,
    () => ({
      async save(overrideCourseId?: string) {
        const id = overrideCourseId ?? courseId;
        if (!id) return;
        await apiFetch("/api/admin/course-billing", {
          method: "PUT",
          body: JSON.stringify({
            course_id: id,
            unitRates: Object.values(rates),
            fixed,
          }),
        });
      },
    }),
    [courseId, rates, fixed],
  );

  function setRate(unitId: string, key: keyof Omit<UnitRate, "unit_id">, value: number) {
    setRates((prev) => ({ ...prev, [unitId]: { ...prev[unitId], [key]: value } }));
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">単価設定</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">従量（個数×単価）と固定（日当）は加算されます。両方0なら計上なし。</p>
      </div>

      {createModeNoCarrier ? (
        <div className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
          左で「キャリア」を選択すると、そのキャリアの単価設定が表示されます。
        </div>
      ) : loading ? (
        <p className="text-slate-400 text-xs">読み込み中…</p>
      ) : (
        <>
          {carrierMissing && (
            <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
              このコースにキャリアが設定されていません。従量unitは表示されません（固定のみ設定可）。
              左の「キャリア」を設定してください。
            </div>
          )}

          {/* 従量（unit別） */}
          {units.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-2">従量（型ごとの単価 / 個）</h4>
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
            <h4 className="text-xs font-semibold text-slate-700 mb-2">固定（日当 / 1シフト）</h4>
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
  );
});

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
