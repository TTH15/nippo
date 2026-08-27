"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { invalidateApi } from "@/lib/swr";
import { DigitInput } from "@/lib/components/DigitInput";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { exclusiveUnitPriceOf, inclusiveUnitPriceOf, roundUnitPrice, UNIT_PRICE_DECIMALS } from "@repo/core/logic/taxBasis";
import type { QuantityRule } from "@/server/billing/quantityRule";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBuilding, faUser, faWarehouse } from "@fortawesome/free-solid-svg-icons";

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
// 日当と歩合は別契約になり得るため、売上/支払 × 固定/歩合の4区分で税基準を持つ。
// 旧 revenue_tax_basis / payout_tax_basis は後方互換のフォールバックとしてのみ使う。
type TaxMode = "excl" | "incl";
type RateMode = "NONE" | "PER_PIECE" | "FIXED" | "BOTH";
type RateConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "danger" | "neutral";
  onConfirm: () => void;
};
// 単価は小数を許す（例: 157.5円/個）。税換算でも円未満を切り捨てない。
const toIncl = (excl: number) => inclusiveUnitPriceOf(excl, "exclusive");
const toExcl = (incl: number) => exclusiveUnitPriceOf(incl, "inclusive");
/** 単価の表示。小数がある場合だけ小数第2位まで見せる（157 は「157」、157.5 は「157.5」） */
const formatPrice = (value: number) =>
  value.toLocaleString("ja-JP", { maximumFractionDigits: UNIT_PRICE_DECIMALS });
/** numeric 列は JSON で文字列になり得る。null/undefined は null のまま返す。 */
const num = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const toExclFor = (mode: TaxMode, raw: number) => (mode === "incl" ? toExcl(raw) : raw);

// 会社利益は手入力させず、売上 − 支払 で自動計算する（入力ミスで合計が合わなくなるのを防ぐ）。
// 売上・支払それぞれのモードに関わらず、両方を税抜に揃えてから差し引く。
const deriveProfit = (revenue: number, payout: number) => roundUnitPrice(revenue - payout);
const rateKey = (cycleNo: number, unitId: string) => `${cycleNo}:${unitId}`;
const hasPerPiece = (mode: RateMode) => mode === "PER_PIECE" || mode === "BOTH";
const hasFixed = (mode: RateMode) => mode === "FIXED" || mode === "BOTH";
const modeFromFlags = (fixed: boolean, perPiece: boolean): RateMode =>
  fixed && perPiece ? "BOTH" : fixed ? "FIXED" : perPiece ? "PER_PIECE" : "NONE";

export type CourseRatePreviewData = {
  courseName: string;
  carrierId: string | null;
  revenueTaxBasis?: "exclusive" | "inclusive";
  payoutTaxBasis?: "exclusive" | "inclusive";
  revenuePieceTaxBasis?: "exclusive" | "inclusive";
  payoutPieceTaxBasis?: "exclusive" | "inclusive";
  revenueFixedTaxBasis?: "exclusive" | "inclusive";
  payoutFixedTaxBasis?: "exclusive" | "inclusive";
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
    previewData?: CourseRatePreviewData;
    onError: (msg: string) => void;
    onDirty?: () => void;
  }
>(function CourseRateEditor({ courseId, carrierId, usesCycles = false, cycles = [], previewData, onError, onDirty }, ref) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [carrierMissing, setCarrierMissing] = useState(false);
  const [rates, setRates] = useState<Record<string, UnitRate>>({});
  const [fixedByCycle, setFixedByCycle] = useState<Record<number, Fixed>>({
    0: { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 },
  });
  const [fixedBundle, setFixedBundle] = useState<FixedBundle>({
    required_cycle_nos: [], revenue_contract_amount: null, payout_contract_amount: null,
  });
  const [revenuePieceTaxMode, setRevenuePieceTaxMode] = useState<TaxMode>("excl");
  const [payoutPieceTaxMode, setPayoutPieceTaxMode] = useState<TaxMode>("excl");
  const [revenueFixedTaxMode, setRevenueFixedTaxMode] = useState<TaxMode>("excl");
  const [payoutFixedTaxMode, setPayoutFixedTaxMode] = useState<TaxMode>("excl");
  const [revenueRateMode, setRevenueRateMode] = useState<RateMode>("PER_PIECE");
  const [payoutRateMode, setPayoutRateMode] = useState<RateMode>("PER_PIECE");
  const [confirmState, setConfirmState] = useState<RateConfirmState | null>(null);

  // 作成モード（courseId 無し）でキャリア未選択なら、まだ何も読まない。
  const createModeNoCarrier = !previewData && !courseId && !carrierId;

  // SWR 化（2026-08 監査）: 同じコースを開き直したときはキャッシュ即表示。
  // hover 先読み（courses 一覧行）と同一キーを共有する。
  const billingKey = previewData || createModeNoCarrier
    ? null
    : `/api/admin/course-billing?${courseId ? `course_id=${courseId}` : `carrier_id=${carrierId}`}`;
  const {
    data: billingData,
    error: billingError,
    isInitialLoading,
  } = useApi<CourseRatePreviewData>(billingKey, { revalidateOnFocus: false });
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
      setRevenuePieceTaxMode("excl");
      setPayoutPieceTaxMode("excl");
      setRevenueFixedTaxMode("excl");
      setPayoutFixedTaxMode("excl");
      setRevenueRateMode("PER_PIECE");
      setPayoutRateMode("PER_PIECE");
    }
  }, [createModeNoCarrier]);

  useEffect(() => {
    const sourceData = previewData ?? billingData;
    if (!sourceData) return;
    if (dirtyRef.current) return; // 編集中はサーバー値で巻き戻さない
    const res = sourceData;
    // サーバー値は常に税抜で保存されている。表示モードはコースに記録された「契約上の真の基準」を復元する。
    // 真の基準が税込のコースは、保存されている税抜値を税込へ逆算して表示する
    // （端数は保存時点で失われているため厳密な逆算ではないが、近似として表示する）。
    const revenuePieceMode = basisToMode(res.revenuePieceTaxBasis ?? res.revenueTaxBasis);
    const payoutPieceMode = basisToMode(res.payoutPieceTaxBasis ?? res.payoutTaxBasis);
    const revenueFixedMode = basisToMode(res.revenueFixedTaxBasis ?? res.revenueTaxBasis);
    const payoutFixedMode = basisToMode(res.payoutFixedTaxBasis ?? res.payoutTaxBasis);
    setRevenuePieceTaxMode(revenuePieceMode);
    setPayoutPieceTaxMode(payoutPieceMode);
    setRevenueFixedTaxMode(revenueFixedMode);
    setPayoutFixedTaxMode(payoutFixedMode);
    setRevenueRateMode(res.revenueRateMode ?? "PER_PIECE");
    setPayoutRateMode(res.payoutRateMode ?? "PER_PIECE");
    setCarrierMissing(!res.carrierId);
    setUnits(res.units ?? []);
    const map: Record<string, UnitRate> = {};
    const activeCycles = usesCycles ? cycles : [{ cycleNo: 0, label: null }];
    activeCycles.forEach((cycle) => (res.units ?? []).forEach((u) => {
      const found = (res.unitRates ?? []).find((r) => (r.cycle_no ?? 0) === cycle.cycleNo && r.unit_id === u.id)
        ?? (res.unitRates ?? []).find((r) => (r.cycle_no ?? 0) === 0 && r.unit_id === u.id);
      // numeric 列は JSON 上で数値/文字列どちらにもなり得るため、必ず数値へ寄せる
      const revenue = revenuePieceMode === "incl"
        ? num(found?.revenue_contract_amount) ?? toIncl(num(found?.revenue_per_unit) ?? 0)
        : num(found?.revenue_per_unit) ?? 0;
      const payout = payoutPieceMode === "incl"
        ? num(found?.payout_contract_amount) ?? toIncl(num(found?.payout_per_unit) ?? 0)
        : num(found?.payout_per_unit) ?? 0;
      map[rateKey(cycle.cycleNo, u.id)] = {
        unit_id: u.id,
        cycle_no: cycle.cycleNo,
        revenue_per_unit: revenue,
        profit_per_unit: recomputeProfitWith(revenuePieceMode, payoutPieceMode, revenue, payout),
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
      const revenue = revenueFixedMode === "incl" ? num(f.revenue_contract_amount) ?? toIncl(num(f.fixed_revenue) ?? 0) : num(f.fixed_revenue) ?? 0;
      const payout = payoutFixedMode === "incl" ? num(f.payout_contract_amount) ?? toIncl(num(f.fixed_payout) ?? 0) : num(f.fixed_payout) ?? 0;
      fixedMap[cycleNo] = {
        cycle_no: cycleNo,
        fixed_revenue: revenue,
        fixed_profit: recomputeProfitWith(revenueFixedMode, payoutFixedMode, revenue, payout),
        fixed_payout: payout,
      };
    });
    setFixedByCycle(fixedMap);
    setFixedBundle({
      required_cycle_nos: res.fixedBundle?.required_cycle_nos ?? cycles.map((cycle) => cycle.cycleNo),
      revenue_contract_amount: num(res.fixedBundle?.revenue_contract_amount)
        ?? (num(res.fixedBundle?.fixed_revenue) == null ? null : revenueFixedMode === "incl" ? toIncl(num(res.fixedBundle?.fixed_revenue)!) : num(res.fixedBundle?.fixed_revenue)!),
      payout_contract_amount: num(res.fixedBundle?.payout_contract_amount)
        ?? (num(res.fixedBundle?.fixed_payout) == null ? null : payoutFixedMode === "incl" ? toIncl(num(res.fixedBundle?.fixed_payout)!) : num(res.fixedBundle?.fixed_payout)!),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingData, previewData]);

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
        // 既存集計との互換列には税抜参考値を保存する。税込モードではここで換算する
        // （入力中・切替中は数値をそのまま保持し、再計算しない）。売上と支払は別モードで換算する。
        const activeCycleNos = usesCycles ? cycles.map((c) => c.cycleNo) : [0];
        const unitRates = activeCycleNos.flatMap((cycleNo) => units.map((unit) => {
          const r = rates[rateKey(cycleNo, unit.id)] ?? {
            unit_id: unit.id, cycle_no: cycleNo, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0,
          };
          const revenue_per_unit = toExclFor(revenuePieceTaxMode, r.revenue_per_unit);
          const payout_per_unit = toExclFor(payoutPieceTaxMode, r.payout_per_unit);
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
          const fixed_revenue = toExclFor(revenueFixedTaxMode, f.fixed_revenue);
          const fixed_payout = toExclFor(payoutFixedTaxMode, f.fixed_payout);
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
            // 旧列は歩合側を代表値として維持する。新処理は下の4区分を参照する。
            revenueTaxBasis: modeToBasis(revenuePieceTaxMode),
            payoutTaxBasis: modeToBasis(payoutPieceTaxMode),
            revenuePieceTaxBasis: modeToBasis(revenuePieceTaxMode),
            payoutPieceTaxBasis: modeToBasis(payoutPieceTaxMode),
            revenueFixedTaxBasis: modeToBasis(revenueFixedTaxMode),
            payoutFixedTaxBasis: modeToBasis(payoutFixedTaxMode),
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
    [courseId, rates, fixedByCycle, fixedBundle, revenuePieceTaxMode, payoutPieceTaxMode, revenueFixedTaxMode, payoutFixedTaxMode, revenueRateMode, payoutRateMode, usesCycles, cycles, units],
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
  const recomputePieceProfit = (revenueRaw: number, payoutRaw: number) =>
    recomputeProfitWith(revenuePieceTaxMode, payoutPieceTaxMode, revenueRaw, payoutRaw);
  const recomputeFixedProfit = (revenueRaw: number, payoutRaw: number) =>
    recomputeProfitWith(revenueFixedTaxMode, payoutFixedTaxMode, revenueRaw, payoutRaw);

  function setRate(cycleNo: number, unitId: string, key: "revenue_per_unit" | "payout_per_unit", value: number) {
    markDirty();
    setRates((prev) => {
      const mapKey = rateKey(cycleNo, unitId);
      const cur = prev[mapKey] ?? { unit_id: unitId, cycle_no: cycleNo, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0 };
      const next = { ...cur, [key]: value };
      next.profit_per_unit = recomputePieceProfit(next.revenue_per_unit, next.payout_per_unit);
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
      next.fixed_profit = recomputeFixedProfit(next.fixed_revenue, next.fixed_payout);
      return { ...prev, [cycleNo]: next };
    });
  }

  function setBundleField(key: "revenue_contract_amount" | "payout_contract_amount", value: number | null) {
    markDirty();
    setFixedBundle((current) => ({ ...current, [key]: value }));
  }

  const changePieceTaxMode = (side: "revenue" | "payout", nextMode: TaxMode) => {
    const current = side === "revenue" ? revenuePieceTaxMode : payoutPieceTaxMode;
    if (nextMode === current) return;
    const hasValue = Object.values(rates).some((rate) => side === "revenue" ? rate.revenue_per_unit !== 0 : rate.payout_per_unit !== 0);
    const sideLabel = `${side === "revenue" ? "売上" : "支払"}歩合`;
    const apply = () => {
      markDirty();
      const nextRevenueMode = side === "revenue" ? nextMode : revenuePieceTaxMode;
      const nextPayoutMode = side === "payout" ? nextMode : payoutPieceTaxMode;
      setRates((prev) => Object.fromEntries(Object.entries(prev).map(([key, rate]) => [key, {
        ...rate,
        profit_per_unit: recomputeProfitWith(nextRevenueMode, nextPayoutMode, rate.revenue_per_unit, rate.payout_per_unit),
      }])));
      if (side === "revenue") setRevenuePieceTaxMode(nextMode);
      else setPayoutPieceTaxMode(nextMode);
    };
    if (!hasValue) return apply();
    setConfirmState({
      title: "税区分を変更しますか？",
      message: `入力済みの${sideLabel}金額は変更せず、契約上の扱いだけを「${nextMode === "incl" ? "税込" : "税抜"}」へ変更します。`,
      confirmLabel: "税区分を変更",
      tone: "neutral",
      onConfirm: apply,
    });
  };

  const changeFixedTaxMode = (side: "revenue" | "payout", nextMode: TaxMode) => {
    const current = side === "revenue" ? revenueFixedTaxMode : payoutFixedTaxMode;
    if (nextMode === current) return;
    const hasValue = Object.values(fixedByCycle).some((fixed) => side === "revenue" ? fixed.fixed_revenue !== 0 : fixed.fixed_payout !== 0)
      || (side === "revenue" ? fixedBundle.revenue_contract_amount != null : fixedBundle.payout_contract_amount != null);
    const sideLabel = `${side === "revenue" ? "売上" : "支払"}日当`;
    const apply = () => {
      markDirty();
      const nextRevenueMode = side === "revenue" ? nextMode : revenueFixedTaxMode;
      const nextPayoutMode = side === "payout" ? nextMode : payoutFixedTaxMode;
      setFixedByCycle((prev) => Object.fromEntries(Object.entries(prev).map(([key, fixed]) => [key, {
        ...fixed,
        fixed_profit: recomputeProfitWith(nextRevenueMode, nextPayoutMode, fixed.fixed_revenue, fixed.fixed_payout),
      }])));
      if (side === "revenue") setRevenueFixedTaxMode(nextMode);
      else setPayoutFixedTaxMode(nextMode);
    };
    if (!hasValue) return apply();
    setConfirmState({
      title: "税区分を変更しますか？",
      message: `入力済みの${sideLabel}金額は変更せず、契約上の扱いだけを「${nextMode === "incl" ? "税込" : "税抜"}」へ変更します。`,
      confirmLabel: "税区分を変更",
      tone: "neutral",
      onConfirm: apply,
    });
  };

  const cycleFixedTotals = cycles.reduce((total, cycle) => {
    const fixed = fixedByCycle[cycle.cycleNo] ?? { fixed_revenue: 0, fixed_payout: 0 };
    return {
      revenue: total.revenue + fixed.fixed_revenue,
      payout: total.payout + fixed.fixed_payout,
    };
  }, { revenue: 0, payout: 0 });

  const activeCycles = usesCycles ? cycles : [{ cycleNo: 0, label: null }];
  const setSideMode = (side: "revenue" | "payout", kind: "fixed" | "piece", enabled: boolean) => {
    const current = side === "revenue" ? revenueRateMode : payoutRateMode;
    const next = modeFromFlags(
      kind === "fixed" ? enabled : hasFixed(current),
      kind === "piece" ? enabled : hasPerPiece(current),
    );
    if (next === "NONE") {
      const hasConfiguredValue = side === "revenue"
        ? Object.values(rates).some((rate) => rate.revenue_per_unit !== 0)
          || Object.values(fixedByCycle).some((fixed) => fixed.fixed_revenue !== 0)
          || fixedBundle.revenue_contract_amount != null
        : Object.values(rates).some((rate) => rate.payout_per_unit !== 0)
          || Object.values(fixedByCycle).some((fixed) => fixed.fixed_payout !== 0)
          || fixedBundle.payout_contract_amount != null;
      const sideLabel = side === "revenue" ? "売上" : "支払";
      if (hasConfiguredValue) {
        setConfirmState({
          title: `${sideLabel}の自動計算を無効にしますか？`,
          message: `保存すると、入力済みの${sideLabel}日当・歩合単価は0円になります。`,
          confirmLabel: "無効にする",
          tone: "danger",
          onConfirm: () => {
            markDirty();
            if (side === "revenue") setRevenueRateMode(next);
            else setPayoutRateMode(next);
          },
        });
        return;
      }
    }
    markDirty();
    if (side === "revenue") setRevenueRateMode(next);
    else setPayoutRateMode(next);
  };

  const renderSide = (side: "revenue" | "payout") => {
    const revenue = side === "revenue";
    const mode = revenue ? revenueRateMode : payoutRateMode;
    const fixedTaxMode = revenue ? revenueFixedTaxMode : payoutFixedTaxMode;
    const pieceTaxMode = revenue ? revenuePieceTaxMode : payoutPieceTaxMode;
    const accent = revenue ? "blue" : "orange";
    const amountKey: "fixed_revenue" | "fixed_payout" = revenue ? "fixed_revenue" : "fixed_payout";
    const unitKey: "revenue_per_unit" | "payout_per_unit" = revenue ? "revenue_per_unit" : "payout_per_unit";
    const quantitySide = revenue ? "revenue" : "payout";

    return (
      <section className="relative z-10 self-start rounded-2xl border border-slate-200 bg-slate-50/95 p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">{revenue ? "売上" : "支払"}</h3>
          <span className="text-[11px] text-slate-400">{revenue ? "取引先からの契約単価" : "ドライバーへの契約単価"}</span>
        </div>

        <RateModeField
          value={mode}
          accent={accent}
          onFixedChange={(enabled) => setSideMode(side, "fixed", enabled)}
          onPieceChange={(enabled) => setSideMode(side, "piece", enabled)}
        />
        <AnimatedSection visible={mode === "BOTH"}>
          <p className="mt-2 text-[11px] text-slate-500">日当と歩合（個数 × 単価）を合算します。</p>
        </AnimatedSection>

        <div className="mt-5">
          <AnimatedSection visible={mode === "NONE"}>
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-400">{revenue ? "自動売上なし" : "自動支払なし"}</div>
          </AnimatedSection>
          <AnimatedSection visible={hasFixed(mode)} gapAfter={hasPerPiece(mode)}>
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-800">日当</h4>
                {usesCycles && cycles.length > 1 && (
                  <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
                    <div className="mb-2 text-xs font-semibold text-slate-600">全サイクル稼働時</div>
                    <OptionalTaxAmountPair
                      mode={fixedTaxMode}
                      value={revenue ? fixedBundle.revenue_contract_amount : fixedBundle.payout_contract_amount}
                      fallback={revenue ? cycleFixedTotals.revenue : cycleFixedTotals.payout}
                      onModeChange={(next) => changeFixedTaxMode(side, next)}
                      onChange={(value) => setBundleField(revenue ? "revenue_contract_amount" : "payout_contract_amount", value)}
                    />
                  </div>
                )}
                <div className={usesCycles && cycles.length > 1 ? "ml-3 space-y-3 border-l-2 border-slate-200 pl-3" : "space-y-3"}>
                  {usesCycles && cycles.length > 1 && (
                    <div className="text-[10px] font-medium tracking-wide text-slate-400">各サイクル</div>
                  )}
                  {activeCycles.map((cycle) => {
                    const fixed = fixedByCycle[cycle.cycleNo] ?? fixedByCycle[0] ?? { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 };
                    const value = fixed[amountKey];
                    return (
                      <div key={cycle.cycleNo} className="rounded-xl border border-slate-200 bg-white p-3">
                        {usesCycles && <div className="mb-2 text-xs font-semibold text-slate-600">{cycle.label?.trim() || `C${cycle.cycleNo}`}</div>}
                        <TaxAmountPair mode={fixedTaxMode} value={value} onModeChange={(next) => changeFixedTaxMode(side, next)}
                          onChange={(next) => setFixedField(cycle.cycleNo, amountKey, next)} />
                      </div>
                    );
                  })}
                </div>
              </div>
          </AnimatedSection>

          <AnimatedSection visible={hasPerPiece(mode)}>
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-800">歩合 <span className="text-xs font-normal text-slate-400">個数 × 単価</span></h4>
                {carrierMissing ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">キャリアを設定すると歩合単価を入力できます。</div>
                ) : units.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-xs text-slate-400">利用できる便・型がありません</div>
                ) : activeCycles.map((cycle) => (
                  <div key={cycle.cycleNo} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                    {usesCycles && <div className="text-xs font-semibold text-slate-600">{cycle.label?.trim() || `C${cycle.cycleNo}`}</div>}
                    {units.map((unit) => {
                      const rate = rates[rateKey(cycle.cycleNo, unit.id)] ?? { unit_id: unit.id, revenue_per_unit: 0, profit_per_unit: 0, payout_per_unit: 0 };
                      return (
                        <div key={unit.id} className="space-y-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                            {unit.name}
                          </div>
                          <TaxAmountPair mode={pieceTaxMode} value={rate[unitKey]} onModeChange={(next) => changePieceTaxMode(side, next)}
                            onChange={(next) => setRate(cycle.cycleNo, unit.id, unitKey, next)} />
                          <QuantityRuleField label="" value={revenue ? rate.revenue_quantity_rule : rate.payout_quantity_rule}
                            onChange={(rule) => setQuantityRule(cycle.cycleNo, unit.id, quantitySide, rule)} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
          </AnimatedSection>
        </div>
      </section>
    );
  };

  return (
    <div className="text-sm">
      {createModeNoCarrier ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">基本情報でキャリアを選択してください。</div>
      ) : loading ? (
        <p className="py-10 text-center text-xs text-slate-400">読み込み中…</p>
      ) : (
        <div className="relative">
          <div aria-hidden="true" className="pointer-events-none absolute left-[4.75rem] right-[5.25rem] top-1/2 hidden -translate-y-1/2 lg:block">
            <div className="mr-[14px] h-1 rounded-l-full bg-slate-300" />
            <span className="absolute right-0 top-1/2 -translate-y-1/2 border-y-[9px] border-l-[14px] border-y-transparent border-l-slate-300" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[6rem_minmax(0,1fr)_5rem_minmax(0,1fr)_6rem] lg:items-start lg:gap-3">
            <div className="relative z-20 hidden flex-col items-center lg:flex lg:self-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-200 bg-blue-50 text-blue-600 shadow-sm"><FontAwesomeIcon icon={faBuilding} className="h-4 w-4" /></div>
              <span className="mt-1 text-[10px] text-slate-500">取引先</span>
            </div>
            {renderSide("revenue")}
            <div className="relative z-20 hidden flex-col items-center lg:flex lg:self-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-slate-800 text-lg text-white shadow-sm"><FontAwesomeIcon icon={faWarehouse} className="h-5 w-5" /></div>
              <span className="mt-1 text-[10px] font-medium text-slate-600">自社</span>
            </div>
            {renderSide("payout")}
            <div className="relative z-20 hidden flex-col items-center lg:flex lg:self-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-orange-200 bg-orange-50 text-orange-600 shadow-sm"><FontAwesomeIcon icon={faUser} className="h-4 w-4" /></div>
              <span className="mt-1 text-[10px] text-slate-500">ドライバー</span>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone}
        onConfirm={() => confirmState?.onConfirm()}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
});

function RateModeField({ value, accent, onFixedChange, onPieceChange }: {
  value: RateMode;
  accent: "blue" | "orange";
  onFixedChange: (enabled: boolean) => void;
  onPieceChange: (enabled: boolean) => void;
}) {
  const activeBorder = accent === "blue" ? "has-[:checked]:border-blue-500" : "has-[:checked]:border-orange-500";
  return (
    <div>
      <div className="mb-1.5 text-[10px] text-slate-400">計算に使う単位</div>
      <div className="grid grid-cols-2 gap-2">
        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 motion-safe:transition-[border-color,background-color,transform] motion-safe:duration-200 active:scale-[0.99] ${activeBorder}`}>
          <input type="checkbox" checked={hasFixed(value)} onChange={(event) => onFixedChange(event.target.checked)} className="h-4 w-4 rounded accent-slate-800 motion-safe:transition-transform motion-safe:duration-200 checked:scale-110" />
          日当
        </label>
        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 motion-safe:transition-[border-color,background-color,transform] motion-safe:duration-200 active:scale-[0.99] ${activeBorder}`}>
          <input type="checkbox" checked={hasPerPiece(value)} onChange={(event) => onPieceChange(event.target.checked)} className="h-4 w-4 rounded accent-slate-800 motion-safe:transition-transform motion-safe:duration-200 checked:scale-110" />
          歩合
        </label>
      </div>
    </div>
  );
}

function AnimatedSection({ visible, gapAfter = false, children }: {
  visible: boolean;
  gapAfter?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={`grid motion-safe:transition-[grid-template-rows,opacity,margin] motion-safe:duration-300 motion-safe:ease-out ${
        visible
          ? `grid-rows-[1fr] opacity-100 ${gapAfter ? "mb-5" : "mb-0"}`
          : "pointer-events-none mb-0 grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function TaxAmountPair({ mode, value, onModeChange, onChange }: {
  mode: TaxMode;
  value: number;
  onModeChange: (mode: TaxMode) => void;
  onChange: (value: number) => void;
}) {
  return (
    <TaxAmountPairFrame mode={mode} value={value} onModeChange={onModeChange}
      input={<NumField label="" value={value} onChange={onChange} compact />} />
  );
}

function OptionalTaxAmountPair({ mode, value, fallback, onModeChange, onChange }: {
  mode: TaxMode;
  value: number | null;
  fallback: number;
  onModeChange: (mode: TaxMode) => void;
  onChange: (value: number | null) => void;
}) {
  return (
    <TaxAmountPairFrame mode={mode} value={value ?? fallback} onModeChange={onModeChange}
      input={<OptionalNumField label="" value={value} fallback={fallback} onChange={onChange} compact />} />
  );
}

function TaxAmountPairFrame({ mode, value, onModeChange, input }: {
  mode: TaxMode;
  value: number;
  onModeChange: (mode: TaxMode) => void;
  input: ReactNode;
}) {
  // 契約単価が整数なら参考額も円単位で見せる（日当が「¥6,499.9」に見えるのを避ける）。
  // 小数を入れた単価だけ、換算後も小数第2位まで見せる。
  const roundIfWhole = (derived: number) => (Number.isInteger(value) ? Math.round(derived) : derived);
  const exclusive = mode === "excl" ? value : roundIfWhole(toExcl(value));
  const inclusive = mode === "incl" ? value : roundIfWhole(toIncl(value));
  const cardClass = (active: boolean) => `rounded-lg border-2 p-2 motion-safe:transition-[border-color,background-color,box-shadow] motion-safe:duration-150 ${
    active
      ? "border-amber-500 bg-amber-50/70 shadow-sm"
      : "cursor-pointer border-slate-200 bg-slate-100 text-slate-400 hover:border-slate-300 hover:bg-slate-50"
  }`;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div role="button" tabIndex={0} onClick={() => onModeChange("excl")}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onModeChange("excl"); } }}
        className={cardClass(mode === "excl")}>
        <span className="mb-1 block text-[10px]">{mode === "excl" ? "契約単価・税抜" : "税抜参考"}</span>
        {mode === "excl" ? input : <span className="block py-1.5 text-right text-base font-semibold">¥{formatPrice(exclusive)}</span>}
      </div>
      <div role="button" tabIndex={0} onClick={() => onModeChange("incl")}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onModeChange("incl"); } }}
        className={cardClass(mode === "incl")}>
        <span className="mb-1 block text-[10px]">{mode === "incl" ? "契約単価・税込" : "税込参考"}</span>
        {mode === "incl" ? input : <span className="block py-1.5 text-right text-base font-semibold">¥{formatPrice(inclusive)}</span>}
      </div>
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
  const minimum = rule.kind === "minimum" ? rule.minimum : 100;
  const changeEnabled = (nextEnabled: boolean) => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    onChange(nextEnabled
      ? { kind: "minimum", minimum: 100, scope: "report" }
      : { kind: "actual" });

    // ページ最下部付近で高さが増えると、ブラウザが最下部へ追従してカード全体が上へ動く。
    // 展開アニメーション中だけクリック時の位置を維持する。大きな差はユーザー操作とみなし追従を止める。
    const keepUntil = performance.now() + (reduceMotion ? 40 : 240);
    const keepViewport = () => {
      if (Math.abs(window.scrollY - scrollY) > 120) return;
      window.scrollTo(scrollX, scrollY);
      if (performance.now() < keepUntil) requestAnimationFrame(keepViewport);
    };
    requestAnimationFrame(keepViewport);
  };
  return (
    <div className={`rounded border px-2.5 py-2 motion-safe:transition-[border-color,background-color] motion-safe:duration-200 ${enabled ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/70"}`}>
      {label && <div className="mb-1 text-[10px] font-medium text-slate-500">{label}の数量計算</div>}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={enabled}
          onChange={(e) => changeEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-slate-800 motion-safe:transition-transform motion-safe:duration-200 checked:scale-110" />
        最低個数を保証する
      </label>
      <div className={`grid motion-safe:transition-[grid-template-rows,opacity,margin] motion-safe:duration-200 motion-safe:ease-out ${enabled ? "mt-2 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="shrink-0">実績が</span>
            <DigitInput value={minimum}
              ariaLabel="最低保証個数"
              disabled={!enabled}
              onValueChange={(next) => onChange({ kind: "minimum", minimum: Math.max(0, next ?? 0), scope: "report" })}
              className="min-w-0 w-20 rounded border border-slate-300 bg-white px-2 py-1.5 text-right text-xs text-slate-700" />
            <span>個以下のとき、{minimum.toLocaleString()}個として集計</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  hint,
  readOnly,
  compact,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  hint?: string;
  readOnly?: boolean;
  compact?: boolean;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[10px] text-slate-500">{label}</span>}
      <DigitInput
        value={value}
        readOnly={readOnly}
        decimals={UNIT_PRICE_DECIMALS}
        onValueChange={(next) => onChange?.(next ?? 0)}
        className={`w-full rounded text-right ${compact ? "border border-slate-300 bg-white px-2.5 py-1.5 text-base font-semibold shadow-sm outline-none motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20" : "border px-2.5 py-2"} ${
          readOnly ? "border-slate-200 bg-slate-50 text-slate-500" : compact ? "" : "border-slate-300"
        }`}
      />
      {hint && <span className="block text-[10px] text-slate-400 mt-0.5 text-right">{hint}</span>}
    </label>
  );
}

function OptionalNumField({ label, value, fallback, onChange, compact = false }: {
  label: string;
  value: number | null;
  fallback: number;
  onChange: (value: number | null) => void;
  compact?: boolean;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[10px] text-slate-500">{label}</span>}
      <DigitInput
        value={value}
        allowEmpty
        decimals={UNIT_PRICE_DECIMALS}
        placeholder={`自動 ¥${formatPrice(fallback)}`}
        onValueChange={onChange}
        className={`w-full rounded border border-slate-300 bg-white text-right shadow-sm outline-none placeholder:text-slate-400 motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 ${compact ? "px-2.5 py-1.5 text-base font-semibold" : "px-2.5 py-2"}`} />
    </label>
  );
}
