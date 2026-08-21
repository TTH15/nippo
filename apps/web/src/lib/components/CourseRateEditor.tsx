"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { invalidateApi } from "@/lib/swr";
import { exclusiveOf, inclusiveOf } from "@repo/core/logic/taxBasis";
import type { QuantityRule } from "@/server/billing/quantityRule";

type Unit = {
  id: string;
  name: string;
  code: string | null;
  billing_type: "PER_PIECE" | "FIXED";
};
type UnitRate = {
  cycle_no?: number;
  unit_id: string;
  revenue_per_unit: number;
  profit_per_unit: number;
  payout_per_unit: number;
  revenue_contract_amount?: number | null;
  payout_contract_amount?: number | null;
  revenue_quantity_rule?: QuantityRule;
  payout_quantity_rule?: QuantityRule;
};
type Fixed = {
  cycle_no?: number;
  fixed_revenue: number;
  fixed_profit: number;
  fixed_payout: number;
  revenue_contract_amount?: number | null;
  payout_contract_amount?: number | null;
};
type FixedBundle = {
  required_cycle_nos: number[];
  revenue_contract_amount: number | null;
  payout_contract_amount: number | null;
};

// 集計単価は税抜（円）で保存し、契約上の入力原額も別列へ保持する。
// 売上は税込で提示されることが多い一方、支払（ドライバー）は税抜の確定額で渡されることが多いため、
// 売上と支払で税区分モードを別々に持てるようにしている。
// このモードはコースに「契約上の真の基準」として永続化され（revenue_tax_basis/payout_tax_basis）、
// 請求書の税込/税抜ペア生成機能から参照される。
type TaxMode = "excl" | "incl";
type RateMode = "NONE" | "PER_PIECE" | "FIXED" | "BOTH";
const toIncl = (excl: number) => inclusiveOf(excl, "exclusive");
const toExcl = (incl: number) => exclusiveOf(incl, "inclusive");
const toExclFor = (mode: TaxMode, raw: number) => (mode === "incl" ? toExcl(raw) : raw);

// 会社利益は手入力させず、売上 − 支払 で自動計算する（入力ミスで合計が合わなくなるのを防ぐ）。
// 売上・支払それぞれのモードに関わらず、両方を税抜に揃えてから差し引く。
const deriveProfit = (revenue: number, payout: number) => revenue - payout;
const rateKey = (cycleNo: number, unitId: string) => `${cycleNo}:${unitId}`;
const hasPerPiece = (mode: RateMode) => mode === "PER_PIECE" || mode === "BOTH";
const hasFixed = (mode: RateMode) => mode === "FIXED" || mode === "BOTH";

type LoadResponse = {
  courseName: string;
  carrierId: string | null;
  revenueTaxBasis?: "exclusive" | "inclusive";
  payoutTaxBasis?: "exclusive" | "inclusive";
  revenueRateMode?: RateMode;
  payoutRateMode?: RateMode;
  units: Unit[];
  unitRates: UnitRate[];
  fixed: Fixed;
  fixedRates?: Fixed[];
  fixedBundle?: (FixedBundle & { fixed_revenue?: number | null; fixed_payout?: number | null }) | null;
};

const basisToMode = (b: "exclusive" | "inclusive" | undefined): TaxMode => (b === "inclusive" ? "incl" : "excl");
const modeToBasis = (m: TaxMode): "exclusive" | "inclusive" => (m === "incl" ? "inclusive" : "exclusive");

export type CourseRateEditorHandle = {
  /**
   * 親モーダルの保存時に呼ぶ。course-billing を保存する。
   * 新規作成時はコース作成後に得た id を overrideCourseId で渡す。
   */
  save: (overrideCourseId?: string, options?: { force?: boolean }) => Promise<void>;
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
    usesCycles?: boolean;
    cycles?: { cycleNo: number; label?: string | null }[];
    onError: (msg: string) => void;
    onDirty?: () => void;
  }
>(function CourseRateEditor({ courseId, carrierId, usesCycles = false, cycles = [], onError, onDirty }, ref) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [carrierMissing, setCarrierMissing] = useState(false);
  const [rates, setRates] = useState<Record<string, UnitRate>>({});
  const [fixedByCycle, setFixedByCycle] = useState<Record<number, Fixed>>({
    0: { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 },
  });
  const [fixedBundle, setFixedBundle] = useState<FixedBundle>({
    required_cycle_nos: [], revenue_contract_amount: null, payout_contract_amount: null,
  });
  const [revenueTaxMode, setRevenueTaxMode] = useState<TaxMode>("excl");
  const [payoutTaxMode, setPayoutTaxMode] = useState<TaxMode>("excl");
  const [revenueRateMode, setRevenueRateMode] = useState<RateMode>("PER_PIECE");
  const [payoutRateMode, setPayoutRateMode] = useState<RateMode>("PER_PIECE");

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
  const dirtyVersionRef = useRef(0);
  useEffect(() => {
    dirtyRef.current = false; // 別コース/キャリアを開いたら編集状態はリセット
    dirtyVersionRef.current = 0;
  }, [billingKey]);

  useEffect(() => {
    if (createModeNoCarrier) {
      setUnits([]);
      setRates({});
      setFixedByCycle({ 0: { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 } });
      setFixedBundle({ required_cycle_nos: [], revenue_contract_amount: null, payout_contract_amount: null });
      setCarrierMissing(false);
      setRevenueTaxMode("excl");
      setPayoutTaxMode("excl");
      setRevenueRateMode("PER_PIECE");
      setPayoutRateMode("PER_PIECE");
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
    setRevenueRateMode(res.revenueRateMode ?? "PER_PIECE");
    setPayoutRateMode(res.payoutRateMode ?? "PER_PIECE");
    setCarrierMissing(!res.carrierId);
    setUnits(res.units ?? []);
    const map: Record<string, UnitRate> = {};
    const activeCycles = usesCycles ? cycles : [{ cycleNo: 0, label: null }];
    activeCycles.forEach((cycle) => (res.units ?? []).forEach((u) => {
      const found = (res.unitRates ?? []).find((r) => (r.cycle_no ?? 0) === cycle.cycleNo && r.unit_id === u.id)
        ?? (res.unitRates ?? []).find((r) => (r.cycle_no ?? 0) === 0 && r.unit_id === u.id);
      const revenue = rMode === "incl"
        ? found?.revenue_contract_amount ?? toIncl(found?.revenue_per_unit ?? 0)
        : found?.revenue_per_unit ?? 0;
      const payout = pMode === "incl"
        ? found?.payout_contract_amount ?? toIncl(found?.payout_per_unit ?? 0)
        : found?.payout_per_unit ?? 0;
      map[rateKey(cycle.cycleNo, u.id)] = {
        unit_id: u.id,
        cycle_no: cycle.cycleNo,
        revenue_per_unit: revenue,
        profit_per_unit: recomputeProfitWith(rMode, pMode, revenue, payout),
        payout_per_unit: payout,
        revenue_quantity_rule: found?.revenue_quantity_rule ?? { kind: "actual" },
        payout_quantity_rule: found?.payout_quantity_rule ?? { kind: "actual" },
      };
    }));
    setRates(map);
    const fixedMap: Record<number, Fixed> = {};
    const sourceFixed = res.fixedRates?.length ? res.fixedRates : [{ ...res.fixed, cycle_no: 0 }];
    sourceFixed.forEach((f) => {
      const cycleNo = f.cycle_no ?? 0;
      const revenue = rMode === "incl" ? f.revenue_contract_amount ?? toIncl(f.fixed_revenue ?? 0) : f.fixed_revenue ?? 0;
      const payout = pMode === "incl" ? f.payout_contract_amount ?? toIncl(f.fixed_payout ?? 0) : f.fixed_payout ?? 0;
      fixedMap[cycleNo] = {
        cycle_no: cycleNo,
        fixed_revenue: revenue,
        fixed_profit: recomputeProfitWith(rMode, pMode, revenue, payout),
        fixed_payout: payout,
      };
    });
    setFixedByCycle(fixedMap);
    setFixedBundle({
      required_cycle_nos: res.fixedBundle?.required_cycle_nos ?? cycles.map((cycle) => cycle.cycleNo),
      revenue_contract_amount: res.fixedBundle?.revenue_contract_amount
        ?? (res.fixedBundle?.fixed_revenue == null ? null : rMode === "incl" ? toIncl(res.fixedBundle.fixed_revenue) : res.fixedBundle.fixed_revenue),
      payout_contract_amount: res.fixedBundle?.payout_contract_amount
        ?? (res.fixedBundle?.fixed_payout == null ? null : pMode === "incl" ? toIncl(res.fixedBundle.fixed_payout) : res.fixedBundle.fixed_payout),
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
      async save(overrideCourseId?: string, options?: { force?: boolean }) {
        const id = overrideCourseId ?? courseId;
        if (!id) return;
        if (!dirtyRef.current && !options?.force) return;
        const savingVersion = dirtyVersionRef.current;
        // 保存は常に税抜。税込モードで入力していた場合はここで初めて換算する
        // （入力中・切替中は数値をそのまま保持し、再計算しない）。売上と支払は別モードで換算する。
        const activeCycleNos = usesCycles ? cycles.map((c) => c.cycleNo) : [0];
        const unitRates = activeCycleNos.flatMap((cycleNo) => units.map((unit) => {
          const r = rates[rateKey(cycleNo, unit.id)] ?? {
            unit_id: unit.id, cycle_no: cycleNo, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0,
          };
          const revenue_per_unit = toExclFor(revenueTaxMode, r.revenue_per_unit);
          const payout_per_unit = toExclFor(payoutTaxMode, r.payout_per_unit);
          return {
            unit_id: r.unit_id,
            cycle_no: cycleNo,
            revenue_per_unit,
            payout_per_unit,
            profit_per_unit: deriveProfit(revenue_per_unit, payout_per_unit),
            revenue_contract_amount: r.revenue_per_unit,
            payout_contract_amount: r.payout_per_unit,
            revenue_quantity_rule: r.revenue_quantity_rule ?? { kind: "actual" },
            payout_quantity_rule: r.payout_quantity_rule ?? { kind: "actual" },
          };
        }));
        const fixedRates = activeCycleNos.map((cycleNo) => {
          const f = fixedByCycle[cycleNo] ?? fixedByCycle[0] ?? { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 };
          const fixed_revenue = toExclFor(revenueTaxMode, f.fixed_revenue);
          const fixed_payout = toExclFor(payoutTaxMode, f.fixed_payout);
          return {
            cycle_no: cycleNo,
            fixed_revenue,
            fixed_payout,
            fixed_profit: deriveProfit(fixed_revenue, fixed_payout),
            revenue_contract_amount: f.fixed_revenue,
            payout_contract_amount: f.fixed_payout,
          };
        });
        await apiFetch("/api/admin/course-billing", {
          method: "PUT",
          body: JSON.stringify({
            course_id: id,
            unitRates,
            fixedRates,
            fixedBundle: usesCycles ? {
              ...fixedBundle,
              required_cycle_nos: cycles.map((cycle) => cycle.cycleNo),
            } : null,
            revenueTaxBasis: modeToBasis(revenueTaxMode),
            payoutTaxBasis: modeToBasis(payoutTaxMode),
            revenueRateMode,
            payoutRateMode,
          }),
        });
        // 保存済み＝以降はサーバー値の同期を受け入れ、キャッシュも最新化しておく
        // （次回開いたときに保存前の値が見えないように）
        // 保存中に追加入力があれば dirty のまま残し、自動保存の次便で最新値を送る。
        if (dirtyVersionRef.current === savingVersion) dirtyRef.current = false;
        void invalidateApi(`/api/admin/course-billing?course_id=${id}`);
      },
    }),
    [courseId, rates, fixedByCycle, fixedBundle, revenueTaxMode, payoutTaxMode, revenueRateMode, payoutRateMode, usesCycles, cycles, units],
  );

  function markDirty() {
    dirtyRef.current = true;
    dirtyVersionRef.current += 1;
    onDirty?.();
  }

  // 利益は常に税抜ベース。売上・支払それぞれのモードを税抜に揃えてから差し引く。
  function recomputeProfitWith(rMode: TaxMode, pMode: TaxMode, revenueRaw: number, payoutRaw: number) {
    return deriveProfit(toExclFor(rMode, revenueRaw), toExclFor(pMode, payoutRaw));
  }
  function recomputeProfit(revenueRaw: number, payoutRaw: number) {
    return recomputeProfitWith(revenueTaxMode, payoutTaxMode, revenueRaw, payoutRaw);
  }

  function setRate(cycleNo: number, unitId: string, key: "revenue_per_unit" | "payout_per_unit", value: number) {
    markDirty();
    setRates((prev) => {
      const mapKey = rateKey(cycleNo, unitId);
      const cur = prev[mapKey] ?? { unit_id: unitId, cycle_no: cycleNo, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0 };
      const next = { ...cur, [key]: value };
      next.profit_per_unit = recomputeProfit(next.revenue_per_unit, next.payout_per_unit);
      return { ...prev, [mapKey]: next };
    });
  }

  function setQuantityRule(cycleNo: number, unitId: string, side: "revenue" | "payout", rule: QuantityRule) {
    markDirty();
    setRates((prev) => {
      const mapKey = rateKey(cycleNo, unitId);
      const cur = prev[mapKey] ?? { unit_id: unitId, cycle_no: cycleNo, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0 };
      return { ...prev, [mapKey]: { ...cur, [`${side}_quantity_rule`]: rule } };
    });
  }

  function setFixedField(cycleNo: number, key: "fixed_revenue" | "fixed_payout", value: number) {
    markDirty();
    setFixedByCycle((prev) => {
      const f = prev[cycleNo] ?? { cycle_no: cycleNo, fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 };
      const next = { ...f, [key]: value };
      next.fixed_profit = recomputeProfit(next.fixed_revenue, next.fixed_payout);
      return { ...prev, [cycleNo]: next };
    });
  }

  function setBundleField(key: "revenue_contract_amount" | "payout_contract_amount", value: number | null) {
    markDirty();
    setFixedBundle((current) => ({ ...current, [key]: value }));
  }

  const changeRevenueMode = (nextMode: TaxMode) => {
    if (nextMode === revenueTaxMode) return;
    const hasValue = Object.values(rates).some((r) => r.revenue_per_unit !== 0) ||
      Object.values(fixedByCycle).some((f) => f.fixed_revenue !== 0);
    if (hasValue && !window.confirm(`入力額は変更せず、売上単価の意味だけを「${nextMode === "incl" ? "税込" : "税抜"}」へ変更しますか？`)) return;
    markDirty();
    setRates((prev) => Object.fromEntries(Object.entries(prev).map(([k, r]) => [k, {
      ...r,
      profit_per_unit: recomputeProfitWith(nextMode, payoutTaxMode, r.revenue_per_unit, r.payout_per_unit),
    }])));
    setFixedByCycle((prev) => Object.fromEntries(Object.entries(prev).map(([k, f]) => [k, {
      ...f,
      fixed_profit: recomputeProfitWith(nextMode, payoutTaxMode, f.fixed_revenue, f.fixed_payout),
    }])));
    setRevenueTaxMode(nextMode);
  };

  const changePayoutMode = (nextMode: TaxMode) => {
    if (nextMode === payoutTaxMode) return;
    const hasValue = Object.values(rates).some((r) => r.payout_per_unit !== 0) ||
      Object.values(fixedByCycle).some((f) => f.fixed_payout !== 0);
    if (hasValue && !window.confirm(`入力額は変更せず、支払単価の意味だけを「${nextMode === "incl" ? "税込" : "税抜"}」へ変更しますか？`)) return;
    markDirty();
    setRates((prev) => Object.fromEntries(Object.entries(prev).map(([k, r]) => [k, {
      ...r,
      profit_per_unit: recomputeProfitWith(revenueTaxMode, nextMode, r.revenue_per_unit, r.payout_per_unit),
    }])));
    setFixedByCycle((prev) => Object.fromEntries(Object.entries(prev).map(([k, f]) => [k, {
      ...f,
      fixed_profit: recomputeProfitWith(revenueTaxMode, nextMode, f.fixed_revenue, f.fixed_payout),
    }])));
    setPayoutTaxMode(nextMode);
  };

  // hint は「今の数値をもう一方の税区分だと換算するといくらか」の参考表示。
  const hintFor = (mode: TaxMode, raw: number) =>
    mode === "incl" ? `税抜換算 ¥${toExcl(raw).toLocaleString()}` : `税込換算 ¥${toIncl(raw).toLocaleString()}`;
  const taxLabel = (mode: TaxMode) => (mode === "incl" ? "税込" : "税抜");
  const cycleFixedTotals = cycles.reduce((total, cycle) => {
    const fixed = fixedByCycle[cycle.cycleNo] ?? { fixed_revenue: 0, fixed_payout: 0 };
    return {
      revenue: total.revenue + fixed.fixed_revenue,
      payout: total.payout + fixed.fixed_payout,
    };
  }, { revenue: 0, payout: 0 });

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">単価設定</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <RateModeField label="取引先への売上" value={revenueRateMode}
          taxMode={revenueTaxMode} onTaxModeChange={changeRevenueMode}
          onChange={(mode) => { markDirty(); setRevenueRateMode(mode); }} />
        <RateModeField label="ドライバーへの支払" value={payoutRateMode}
          taxMode={payoutTaxMode} onTaxModeChange={changePayoutMode}
          onChange={(mode) => { markDirty(); setPayoutRateMode(mode); }} />
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
          {units.length > 0 && (hasPerPiece(revenueRateMode) || hasPerPiece(payoutRateMode)) && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-2">個数単価（便・型ごと）</h4>
              <div className="space-y-3">
                {(usesCycles ? cycles : [{ cycleNo: 0, label: null }]).map((cycle) => (
                  <div key={cycle.cycleNo} className={usesCycles ? "rounded border border-slate-200 bg-slate-50/40 p-3" : ""}>
                    {usesCycles ? (
                      <div className="mb-2 text-xs font-semibold text-slate-700">{cycle.label?.trim() || `${cycle.cycleNo}便`}</div>
                    ) : null}
                    <div className="space-y-3">
                      {units.map((u) => {
                        const r = rates[rateKey(cycle.cycleNo, u.id)] ?? {
                          unit_id: u.id, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0,
                        };
                        return (
                          <div key={u.id} className="rounded border border-slate-200 bg-white p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-medium text-slate-800">{u.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                                {u.billing_type === "FIXED" ? "固定型" : "従量型"}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {hasPerPiece(revenueRateMode) ? (
                                <NumField label={`売上単価（${taxLabel(revenueTaxMode)}）/個`} value={r.revenue_per_unit}
                                  onChange={(v) => setRate(cycle.cycleNo, u.id, "revenue_per_unit", v)}
                                  hint={hintFor(revenueTaxMode, r.revenue_per_unit)} />
                              ) : <NotApplicable label="売上" mode={revenueRateMode} />}
                              {hasPerPiece(payoutRateMode) ? (
                                <NumField label={`支払単価（${taxLabel(payoutTaxMode)}）/個`} value={r.payout_per_unit}
                                  onChange={(v) => setRate(cycle.cycleNo, u.id, "payout_per_unit", v)}
                                  hint={hintFor(payoutTaxMode, r.payout_per_unit)} />
                              ) : <NotApplicable label="支払" mode={payoutRateMode} />}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                              {hasPerPiece(revenueRateMode) ? <QuantityRuleField label="売上" value={r.revenue_quantity_rule}
                                onChange={(rule) => setQuantityRule(cycle.cycleNo, u.id, "revenue", rule)} /> : <div />}
                              {hasPerPiece(payoutRateMode) ? <QuantityRuleField label="支払" value={r.payout_quantity_rule}
                                onChange={(rule) => setQuantityRule(cycle.cycleNo, u.id, "payout", rule)} /> : <div />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 固定（日当） */}
          {(hasFixed(revenueRateMode) || hasFixed(payoutRateMode)) && <div>
            <h4 className="text-xs font-semibold text-slate-700 mb-2">固定（日当 / 1シフト）</h4>
            <div className="space-y-3">
              {usesCycles && cycles.length > 1 ? (
                <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2.5">
                  <div className="mb-2 text-xs font-semibold text-slate-700">全日の日当</div>
                  <div className="grid grid-cols-2 gap-2">
                    {hasFixed(revenueRateMode) ? (
                      <OptionalNumField
                        label={`売上日当（${taxLabel(revenueTaxMode)}）`}
                        value={fixedBundle.revenue_contract_amount}
                        fallback={cycleFixedTotals.revenue}
                        onChange={(value) => setBundleField("revenue_contract_amount", value)}
                      />
                    ) : <NotApplicable label="売上" mode={revenueRateMode} />}
                    {hasFixed(payoutRateMode) ? (
                      <OptionalNumField
                        label={`支払日当（${taxLabel(payoutTaxMode)}）`}
                        value={fixedBundle.payout_contract_amount}
                        fallback={cycleFixedTotals.payout}
                        onChange={(value) => setBundleField("payout_contract_amount", value)}
                      />
                    ) : <NotApplicable label="支払" mode={payoutRateMode} />}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">未入力の場合は便別日当の合計を使用します。</div>
                </div>
              ) : null}
              {(usesCycles ? cycles : [{ cycleNo: 0, label: null }]).map((cycle) => {
                const f = fixedByCycle[cycle.cycleNo] ?? fixedByCycle[0] ?? { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 };
                return (
                  <div key={cycle.cycleNo} className={usesCycles ? "rounded border border-slate-200 p-3" : ""}>
                    {usesCycles ? (
                      <div className="mb-2 text-xs font-semibold text-slate-700">
                        {cycle.label?.trim() || `${cycle.cycleNo}便`}
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      {hasFixed(revenueRateMode) ? <NumField
                        label={`売上日当（${taxLabel(revenueTaxMode)}）`}
                        value={f.fixed_revenue}
                        onChange={(v) => setFixedField(cycle.cycleNo, "fixed_revenue", v)}
                        hint={hintFor(revenueTaxMode, f.fixed_revenue)}
                      /> : <NotApplicable label="売上" mode={revenueRateMode} />}
                      {hasFixed(payoutRateMode) ? <NumField
                        label={`支払日当（${taxLabel(payoutTaxMode)}）`}
                        value={f.fixed_payout}
                        onChange={(v) => setFixedField(cycle.cycleNo, "fixed_payout", v)}
                        hint={hintFor(payoutTaxMode, f.fixed_payout)}
                      /> : <NotApplicable label="支払" mode={payoutRateMode} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}
        </>
      )}
    </div>
  );
});

function RateModeField({ label, value, taxMode, onChange, onTaxModeChange }: {
  label: string;
  value: RateMode;
  taxMode: TaxMode;
  onChange: (value: RateMode) => void;
  onTaxModeChange: (value: TaxMode) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="mb-2 text-[11px] font-semibold text-slate-700">{label}</div>
      <label className="block">
        <span className="mb-1 block text-[10px] text-slate-500">計算方法</span>
        <select value={value} onChange={(e) => onChange(e.target.value as RateMode)}
          className="w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700">
          <option value="PER_PIECE">個数で計算</option>
          <option value="FIXED">日当で計算</option>
          <option value="BOTH">個数＋日当</option>
          <option value="NONE">計上しない</option>
        </select>
      </label>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">単価の税区分</span>
        <TaxModeToggle value={taxMode} onChange={onTaxModeChange} />
      </div>
    </div>
  );
}

function NotApplicable({ label, mode }: { label: string; mode: RateMode }) {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-400">
      <span className="block text-[10px] mb-1">{label}</span>
      {mode === "FIXED" ? "日当で設定" : mode === "NONE" ? "計上なし" : "個数で設定"}
    </div>
  );
}

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

function QuantityRuleField({ label, value, onChange }: {
  label: string;
  value?: QuantityRule;
  onChange: (rule: QuantityRule) => void;
}) {
  const rule = value?.kind === "minimum" ? value : { kind: "actual" as const };
  const enabled = rule.kind === "minimum";
  return (
    <div className="rounded border border-slate-200 bg-slate-50/70 px-2.5 py-2">
      <div className="mb-1 text-[10px] font-medium text-slate-500">{label}の数量計算</div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={enabled}
          onChange={(e) => onChange(e.target.checked
            ? { kind: "minimum", minimum: 100, scope: "report" }
            : { kind: "actual" })}
          className="h-4 w-4 rounded border-slate-300 accent-slate-800" />
        最低個数を保証する
      </label>
      {enabled ? (
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="shrink-0">1日報あたり</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={rule.minimum}
            onChange={(e) => onChange({ kind: "minimum", minimum: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0), scope: "report" })}
            className="min-w-0 w-20 rounded border border-slate-300 bg-white px-2 py-1.5 text-right text-xs text-slate-700" />
          <span className="shrink-0">個として計算</span>
        </label>
      ) : null}
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

function OptionalNumField({ label, value, fallback, onChange }: {
  label: string;
  value: number | null;
  fallback: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-slate-500">{label}</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*"
        value={value ?? ""}
        placeholder={`自動 ¥${fallback.toLocaleString()}`}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          onChange(digits === "" ? null : Number(digits));
        }}
        className="w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-right placeholder:text-slate-400" />
    </label>
  );
}
