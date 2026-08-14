"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { invalidateApi } from "@/lib/swr";
import { exclusiveOf, inclusiveOf } from "@repo/core/logic/taxBasis";

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

// 単価は税抜（円）で保存する。税抜/税込モードの切替では入力値を再計算せず、保存時のみ換算する。
// 売上は税込で提示されることが多い一方、支払（ドライバー）は税抜の確定額で渡されることが多いため、
// 売上と支払で税区分モードを別々に持てるようにしている。
// このモードはコースに「契約上の真の基準」として永続化され（revenue_tax_basis/payout_tax_basis）、
// 請求書の税込/税抜ペア生成機能から参照される。
type TaxMode = "excl" | "incl";
const toIncl = (excl: number) => inclusiveOf(excl, "exclusive");
const toExcl = (incl: number) => exclusiveOf(incl, "inclusive");
const toExclFor = (mode: TaxMode, raw: number) => (mode === "incl" ? toExcl(raw) : raw);

// 会社利益は手入力させず、売上 − 支払 で自動計算する（入力ミスで合計が合わなくなるのを防ぐ）。
// 売上・支払それぞれのモードに関わらず、両方を税抜に揃えてから差し引く。
const deriveProfit = (revenue: number, payout: number) => revenue - payout;

type LoadResponse = {
  courseName: string;
  carrierId: string | null;
  revenueTaxBasis?: "exclusive" | "inclusive";
  payoutTaxBasis?: "exclusive" | "inclusive";
  units: Unit[];
  unitRates: UnitRate[];
  fixed: Fixed;
};

const basisToMode = (b: "exclusive" | "inclusive" | undefined): TaxMode => (b === "inclusive" ? "incl" : "excl");
const modeToBasis = (m: TaxMode): "exclusive" | "inclusive" => (m === "incl" ? "inclusive" : "exclusive");

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
  const [units, setUnits] = useState<Unit[]>([]);
  const [carrierMissing, setCarrierMissing] = useState(false);
  const [rates, setRates] = useState<Record<string, UnitRate>>({});
  const [fixed, setFixed] = useState<Fixed>({ fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 });
  const [revenueTaxMode, setRevenueTaxMode] = useState<TaxMode>("excl");
  const [payoutTaxMode, setPayoutTaxMode] = useState<TaxMode>("excl");

  // 作成モード（courseId 無し）でキャリア未選択なら、まだ何も読まない。
  const createModeNoCarrier = !courseId && !carrierId;

  // SWR 化（2026-08 監査）: 同じコースを開き直したときはキャッシュ即表示。
  // hover 先読み（courses 一覧行）と同一キーを共有する。
  const billingKey = createModeNoCarrier
    ? null
    : `/api/admin/course-billing?${courseId ? `course_id=${courseId}` : `carrier_id=${carrierId}`}`;
  const {
    data: billingData,
    error: billingError,
    isInitialLoading,
  } = useApi<LoadResponse>(billingKey, { revalidateOnFocus: false });
  const loading = billingKey ? isInitialLoading : false;
  // ユーザーが編集を始めたら、裏の再検証でフォームを上書きしない（dirty ガード）
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = false; // 別コース/キャリアを開いたら編集状態はリセット
  }, [billingKey]);

  useEffect(() => {
    if (createModeNoCarrier) {
      setUnits([]);
      setRates({});
      setFixed({ fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 });
      setCarrierMissing(false);
      setRevenueTaxMode("excl");
      setPayoutTaxMode("excl");
    }
  }, [createModeNoCarrier]);

  useEffect(() => {
    if (!billingData) return;
    if (dirtyRef.current) return; // 編集中はサーバー値で巻き戻さない
    const res = billingData;
    // サーバー値は常に税抜で保存されている。表示モードはコースに記録された「契約上の真の基準」を復元する。
    // 真の基準が税込のコースは、保存されている税抜値を税込へ逆算して表示する
    // （端数は保存時点で失われているため厳密な逆算ではないが、近似として表示する）。
    const rMode = basisToMode(res.revenueTaxBasis);
    const pMode = basisToMode(res.payoutTaxBasis);
    setRevenueTaxMode(rMode);
    setPayoutTaxMode(pMode);
    setCarrierMissing(!res.carrierId);
    setUnits(res.units ?? []);
    const map: Record<string, UnitRate> = {};
    (res.units ?? []).forEach((u) => {
      const found = (res.unitRates ?? []).find((r) => r.unit_id === u.id);
      const revenue = rMode === "incl" ? toIncl(found?.revenue_per_unit ?? 0) : found?.revenue_per_unit ?? 0;
      const payout = pMode === "incl" ? toIncl(found?.payout_per_unit ?? 0) : found?.payout_per_unit ?? 0;
      map[u.id] = {
        unit_id: u.id,
        revenue_per_unit: revenue,
        profit_per_unit: recomputeProfitWith(rMode, pMode, revenue, payout),
        payout_per_unit: payout,
      };
    });
    setRates(map);
    const fixedRevenueRaw = res.fixed?.fixed_revenue ?? 0;
    const fixedPayoutRaw = res.fixed?.fixed_payout ?? 0;
    const fixedRevenue = rMode === "incl" ? toIncl(fixedRevenueRaw) : fixedRevenueRaw;
    const fixedPayout = pMode === "incl" ? toIncl(fixedPayoutRaw) : fixedPayoutRaw;
    setFixed({
      fixed_revenue: fixedRevenue,
      fixed_profit: recomputeProfitWith(rMode, pMode, fixedRevenue, fixedPayout),
      fixed_payout: fixedPayout,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingData]);

  useEffect(() => {
    if (billingError) onError(billingError instanceof Error ? billingError.message : "単価の読み込みに失敗しました");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingError]);

  useImperativeHandle(
    ref,
    () => ({
      async save(overrideCourseId?: string) {
        const id = overrideCourseId ?? courseId;
        if (!id) return;
        // 保存は常に税抜。税込モードで入力していた場合はここで初めて換算する
        // （入力中・切替中は数値をそのまま保持し、再計算しない）。売上と支払は別モードで換算する。
        const unitRates = Object.values(rates).map((r) => {
          const revenue_per_unit = toExclFor(revenueTaxMode, r.revenue_per_unit);
          const payout_per_unit = toExclFor(payoutTaxMode, r.payout_per_unit);
          return {
            unit_id: r.unit_id,
            revenue_per_unit,
            payout_per_unit,
            profit_per_unit: deriveProfit(revenue_per_unit, payout_per_unit),
          };
        });
        const fixed_revenue = toExclFor(revenueTaxMode, fixed.fixed_revenue);
        const fixed_payout = toExclFor(payoutTaxMode, fixed.fixed_payout);
        await apiFetch("/api/admin/course-billing", {
          method: "PUT",
          body: JSON.stringify({
            course_id: id,
            unitRates,
            fixed: { fixed_revenue, fixed_payout, fixed_profit: deriveProfit(fixed_revenue, fixed_payout) },
            revenueTaxBasis: modeToBasis(revenueTaxMode),
            payoutTaxBasis: modeToBasis(payoutTaxMode),
          }),
        });
        // 保存済み＝以降はサーバー値の同期を受け入れ、キャッシュも最新化しておく
        // （次回開いたときに保存前の値が見えないように）
        dirtyRef.current = false;
        void invalidateApi(`/api/admin/course-billing?course_id=${id}`);
      },
    }),
    [courseId, rates, fixed, revenueTaxMode, payoutTaxMode],
  );

  // 利益は常に税抜ベース。売上・支払それぞれのモードを税抜に揃えてから差し引く。
  function recomputeProfitWith(rMode: TaxMode, pMode: TaxMode, revenueRaw: number, payoutRaw: number) {
    return deriveProfit(toExclFor(rMode, revenueRaw), toExclFor(pMode, payoutRaw));
  }
  function recomputeProfit(revenueRaw: number, payoutRaw: number) {
    return recomputeProfitWith(revenueTaxMode, payoutTaxMode, revenueRaw, payoutRaw);
  }

  function setRate(unitId: string, key: "revenue_per_unit" | "payout_per_unit", value: number) {
    dirtyRef.current = true;
    setRates((prev) => {
      const cur = prev[unitId] ?? { unit_id: unitId, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0 };
      const next = { ...cur, [key]: value };
      next.profit_per_unit = recomputeProfit(next.revenue_per_unit, next.payout_per_unit);
      return { ...prev, [unitId]: next };
    });
  }

  function setFixedField(key: "fixed_revenue" | "fixed_payout", value: number) {
    dirtyRef.current = true;
    setFixed((f) => {
      const next = { ...f, [key]: value };
      next.fixed_profit = recomputeProfit(next.fixed_revenue, next.fixed_payout);
      return next;
    });
  }

  // 入力欄には常に入力した数値をそのまま表示する（税抜/税込の切替では再計算しない）。
  // hint は「今の数値をもう一方の税区分だと仮に換算するといくらか」の参考表示。
  const hintFor = (mode: TaxMode, raw: number) =>
    mode === "incl" ? `税抜 ¥${toExcl(raw).toLocaleString()}` : `税込 ¥${toIncl(raw).toLocaleString()}`;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">単価設定</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">従量（個数×単価）と固定（日当）は加算されます。両方0なら計上なし。</p>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-[11px] text-slate-500">入力単位</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">売上</span>
          <TaxModeToggle value={revenueTaxMode} onChange={(m) => { dirtyRef.current = true; setRevenueTaxMode(m); }} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">支払</span>
          <TaxModeToggle value={payoutTaxMode} onChange={(m) => { dirtyRef.current = true; setPayoutTaxMode(m); }} />
        </div>
      </div>
      <p className="text-[10px] text-slate-400">
        切替時は数値そのまま／保存時のみ税抜に換算（10%）。利益は税抜ベースで自動計算されます。
      </p>

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
                      <NumField
                        label="売上/個"
                        value={rates[u.id]?.revenue_per_unit ?? 0}
                        onChange={(v) => setRate(u.id, "revenue_per_unit", v)}
                        hint={hintFor(revenueTaxMode, rates[u.id]?.revenue_per_unit ?? 0)}
                      />
                      <NumField
                        label="利益/個（自動計算）"
                        value={rates[u.id]?.profit_per_unit ?? 0}
                        hint={`税込 ¥${toIncl(rates[u.id]?.profit_per_unit ?? 0).toLocaleString()}`}
                        readOnly
                      />
                      <NumField
                        label="支払/個"
                        value={rates[u.id]?.payout_per_unit ?? 0}
                        onChange={(v) => setRate(u.id, "payout_per_unit", v)}
                        hint={hintFor(payoutTaxMode, rates[u.id]?.payout_per_unit ?? 0)}
                      />
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
              <NumField
                label="売上"
                value={fixed.fixed_revenue}
                onChange={(v) => setFixedField("fixed_revenue", v)}
                hint={hintFor(revenueTaxMode, fixed.fixed_revenue)}
              />
              <NumField
                label="利益（自動計算）"
                value={fixed.fixed_profit}
                hint={`税込 ¥${toIncl(fixed.fixed_profit).toLocaleString()}`}
                readOnly
              />
              <NumField
                label="支払"
                value={fixed.fixed_payout}
                onChange={(v) => setFixedField("fixed_payout", v)}
                hint={hintFor(payoutTaxMode, fixed.fixed_payout)}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">混在コース（歩合＋日当）は従量と固定の両方を入力してください。</p>
          </div>
        </>
      )}
    </div>
  );
});

function TaxModeToggle({ value, onChange }: { value: TaxMode; onChange: (v: TaxMode) => void }) {
  return (
    <div className="inline-flex rounded border border-slate-300 overflow-hidden text-[11px]">
      <button
        type="button"
        onClick={() => onChange("excl")}
        className={`px-2.5 py-1 ${value === "excl" ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}
      >
        税抜
      </button>
      <button
        type="button"
        onClick={() => onChange("incl")}
        className={`px-2.5 py-1 border-l border-slate-300 ${value === "incl" ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}
      >
        税込
      </button>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  hint,
  readOnly,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  hint?: string;
  readOnly?: boolean;
}) {
  // type="number" を value=0 で制御すると、全消去した瞬間に "0" が居座り、続きの入力が
  // "059" のように積み上がる。編集中はテキストをそのまま保持し、外部からの変更（自動計算・
  // 読み込み直後など）のときだけ同期する。
  const [text, setText] = useState(String(value));

  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 mb-1">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        readOnly={readOnly}
        onChange={
          readOnly
            ? undefined
            : (e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setText(digits);
                onChange?.(digits === "" ? 0 : Number(digits));
              }
        }
        onBlur={() => {
          if (!readOnly && text === "") setText("0");
        }}
        className={`w-full px-2.5 py-2 border rounded text-right ${
          readOnly ? "border-slate-200 bg-slate-50 text-slate-500" : "border-slate-300"
        }`}
      />
      {hint && <span className="block text-[10px] text-slate-400 mt-0.5 text-right">{hint}</span>}
    </label>
  );
}
