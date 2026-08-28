/**
 * コース単価履歴（course_rate_versions.rate_data）の正規化と検証。
 *
 * 履歴は「保存ログ」ではなく単価の正本として扱う。過去日の集計を遡って作り直す入力に
 * なるため、壊れた値が1件混ざるだけで売上が数十万円動く（2026-08-28 の事故）。
 * 保存前にここで形と値を確かめ、読み出し時は旧形式(v1)も同じ形へ寄せる。
 */
import type { TaxBasis } from "./taxBasis";

export type RateMode = "NONE" | "PER_PIECE" | "FIXED" | "BOTH";

/** 契約額と、集計・税務提出に使う税抜額。税込契約でも別額を持てる（税込160円／税抜145円） */
export type RateAmount = {
  contract: number;
  exclusive: number;
};

export type RateVersionUnit = {
  cycleNo: number;
  unitId: string;
  revenue: RateAmount;
  payout: RateAmount;
  revenueQuantityRule?: unknown;
  payoutQuantityRule?: unknown;
};

export type RateVersionFixed = {
  cycleNo: number;
  revenue: RateAmount;
  payout: RateAmount;
};

export type RateVersionBundle = {
  requiredCycleNos: number[];
  revenue: RateAmount | null;
  payout: RateAmount | null;
};

export type RateVersionData = {
  version: 2;
  revenueRateMode: RateMode;
  payoutRateMode: RateMode;
  taxBasis: {
    revenuePiece: TaxBasis;
    payoutPiece: TaxBasis;
    revenueFixed: TaxBasis;
    payoutFixed: TaxBasis;
  };
  unitRates: RateVersionUnit[];
  fixedRates: RateVersionFixed[];
  fixedBundle: RateVersionBundle | null;
};

const TAX_RATE = 1.1;
const RATE_MODES: RateMode[] = ["NONE", "PER_PIECE", "FIXED", "BOTH"];
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const mode = (value: unknown, fallback: RateMode = "BOTH"): RateMode =>
  RATE_MODES.includes(value as RateMode) ? (value as RateMode) : fallback;
const basis = (value: unknown, fallback: TaxBasis = "exclusive"): TaxBasis =>
  value === "inclusive" ? "inclusive" : value === "exclusive" ? "exclusive" : fallback;

/**
 * 旧形式(v1: 保存APIのリクエストほぼそのまま)を v2 へ寄せる。
 * v1 は `revenue_per_unit`(税抜) と `revenue_contract_amount`(契約額) を別々に持ち、
 * 契約額が未保存の行がある。その場合は税抜額を契約額として扱う
 * （コースの税基準を当てると税抜値を税込と誤解釈して約10%目減りする）。
 */
export function normalizeRateVersion(raw: unknown): RateVersionData | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, any>;
  if (data.version === 2) return data as RateVersionData;

  const amount = (stored: unknown, contract: unknown): RateAmount => {
    const exclusive = num(stored);
    return { contract: contract == null ? exclusive : num(contract), exclusive };
  };
  /** 税抜が保存されていない全日日当向け。契約額と税基準から税抜を導く。 */
  const bundleAmount = (stored: unknown, contract: unknown, taxBasis: TaxBasis): RateAmount | null => {
    if (contract == null && stored == null) return null;
    const contractValue = contract == null ? num(stored) : num(contract);
    const exclusive = stored != null
      ? num(stored)
      : taxBasis === "inclusive" ? Math.floor(contractValue / TAX_RATE) : contractValue;
    return { contract: contractValue, exclusive };
  };
  const legacyRevenue = basis(data.revenueTaxBasis);
  const legacyPayout = basis(data.payoutTaxBasis);

  return {
    version: 2,
    revenueRateMode: mode(data.revenueRateMode),
    payoutRateMode: mode(data.payoutRateMode),
    taxBasis: {
      revenuePiece: basis(data.revenuePieceTaxBasis, legacyRevenue),
      payoutPiece: basis(data.payoutPieceTaxBasis, legacyPayout),
      revenueFixed: basis(data.revenueFixedTaxBasis, legacyRevenue),
      payoutFixed: basis(data.payoutFixedTaxBasis, legacyPayout),
    },
    unitRates: (Array.isArray(data.unitRates) ? data.unitRates : []).map((r: any) => ({
      cycleNo: num(r.cycle_no),
      unitId: String(r.unit_id ?? ""),
      revenue: amount(r.revenue_per_unit, r.revenue_contract_amount),
      payout: amount(r.payout_per_unit, r.payout_contract_amount),
      revenueQuantityRule: r.revenue_quantity_rule,
      payoutQuantityRule: r.payout_quantity_rule,
    })),
    fixedRates: (Array.isArray(data.fixedRates) ? data.fixedRates : []).map((r: any) => ({
      cycleNo: num(r.cycle_no),
      revenue: amount(r.fixed_revenue, r.revenue_contract_amount),
      payout: amount(r.fixed_payout, r.payout_contract_amount),
    })),
    fixedBundle: data.fixedBundle && typeof data.fixedBundle === "object" ? {
      requiredCycleNos: Array.isArray(data.fixedBundle.required_cycle_nos)
        ? data.fixedBundle.required_cycle_nos.map(num) : [],
      // v1 の全日日当は契約額しか持たない（税抜はサーバ側で導出していた）。
      // 契約額をそのまま税抜として扱うと税込を税抜と誤解釈するため、税基準から導く。
      revenue: bundleAmount(
        data.fixedBundle.fixed_revenue, data.fixedBundle.revenue_contract_amount,
        basis(data.revenueFixedTaxBasis, legacyRevenue)),
      payout: bundleAmount(
        data.fixedBundle.fixed_payout, data.fixedBundle.payout_contract_amount,
        basis(data.payoutFixedTaxBasis, legacyPayout)),
    } : null,
  };
}

export type RateVersionIssue = {
  level: "error" | "warning";
  label: string;
  message: string;
};

/** 税込契約で税抜額がここまで離れていたら誤りとみなす（税込160円→税抜145円 は許す） */
const BASIS_TOLERANCE = 0.05;
/** 直前の版からの変動がここを超えたら確認を挟む */
const CHANGE_TOLERANCE = 0.5;

/**
 * 版の値を検証する。
 * error は保存を止める。warning は運営に確認させたうえで保存を許す。
 */
export function validateRateVersion(
  data: RateVersionData,
  previous?: RateVersionData | null,
): RateVersionIssue[] {
  const issues: RateVersionIssue[] = [];

  const checkAmount = (label: string, amount: RateAmount, taxBasis: TaxBasis) => {
    if (!Number.isFinite(amount.contract) || !Number.isFinite(amount.exclusive)) {
      issues.push({ level: "error", label, message: "契約額と税抜額の両方が必要です" });
      return;
    }
    if (amount.contract < 0 || amount.exclusive < 0) {
      issues.push({ level: "error", label, message: "単価にマイナスは指定できません" });
      return;
    }
    if (amount.contract === 0 && amount.exclusive === 0) return;
    if (taxBasis === "inclusive") {
      // 税込契約: 税抜は概ね 契約額 ÷ 1.1。大きく離れていたら取り違えを疑う
      const expected = amount.contract / TAX_RATE;
      if (expected > 0 && Math.abs(amount.exclusive - expected) / expected > BASIS_TOLERANCE) {
        issues.push({
          level: "warning",
          label,
          message: `税込契約 ${amount.contract} に対して税抜 ${amount.exclusive}（目安 ${Math.round(expected)}）。取り違えていませんか`,
        });
      }
    } else if (amount.contract !== amount.exclusive) {
      issues.push({
        level: "warning",
        label,
        message: `税抜契約なのに契約額 ${amount.contract} と税抜 ${amount.exclusive} が違います`,
      });
    }
  };

  data.unitRates.forEach((r) => {
    const suffix = r.cycleNo > 0 ? `・C${r.cycleNo}` : "";
    checkAmount(`歩合売上${suffix}`, r.revenue, data.taxBasis.revenuePiece);
    checkAmount(`歩合支払${suffix}`, r.payout, data.taxBasis.payoutPiece);
  });
  data.fixedRates.forEach((r) => {
    const suffix = r.cycleNo > 0 ? `・C${r.cycleNo}` : "";
    checkAmount(`日当売上${suffix}`, r.revenue, data.taxBasis.revenueFixed);
    checkAmount(`日当支払${suffix}`, r.payout, data.taxBasis.payoutFixed);
  });
  if (data.fixedBundle?.revenue) checkAmount("全日日当売上", data.fixedBundle.revenue, data.taxBasis.revenueFixed);
  if (data.fixedBundle?.payout) checkAmount("全日日当支払", data.fixedBundle.payout, data.taxBasis.payoutFixed);

  if (previous) {
    const compare = (label: string, before: RateAmount | undefined, after: RateAmount) => {
      if (!before || before.exclusive <= 0 || after.exclusive <= 0) return;
      const ratio = Math.abs(after.exclusive - before.exclusive) / before.exclusive;
      if (ratio > CHANGE_TOLERANCE) {
        issues.push({
          level: "warning",
          label,
          message: `前回の ${before.exclusive} から ${after.exclusive} へ ${Math.round(ratio * 100)}% 動きます`,
        });
      }
    };
    data.unitRates.forEach((r) => {
      const before = previous.unitRates.find((p) => p.unitId === r.unitId && p.cycleNo === r.cycleNo);
      compare(`歩合売上${r.cycleNo > 0 ? `・C${r.cycleNo}` : ""}`, before?.revenue, r.revenue);
      compare(`歩合支払${r.cycleNo > 0 ? `・C${r.cycleNo}` : ""}`, before?.payout, r.payout);
    });
    data.fixedRates.forEach((r) => {
      const before = previous.fixedRates.find((p) => p.cycleNo === r.cycleNo);
      compare(`日当売上${r.cycleNo > 0 ? `・C${r.cycleNo}` : ""}`, before?.revenue, r.revenue);
      compare(`日当支払${r.cycleNo > 0 ? `・C${r.cycleNo}` : ""}`, before?.payout, r.payout);
    });
  }

  return issues;
}

/** 指定日に適用される版を選ぶ。検証に落ちた版(invalid_reason あり)は使わない。 */
export function selectEffectiveVersion<T extends { effective_from: string; invalid_reason?: string | null }>(
  versions: T[],
  onDate: string,
): T | null {
  return versions
    .filter((v) => !v.invalid_reason && String(v.effective_from) <= onDate)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] ?? null;
}
