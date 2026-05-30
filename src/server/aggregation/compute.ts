// ============================================================
// 集計刷新: 集計の心臓部（純関数・DB非依存）
//
//   売上 = Σ自動算出(従量 + 固定) + Σ台帳(revenue_delta)
//   利益 = Σ自動算出(従量 + 固定) + Σ台帳(profit_delta)
//   支払 = Σ自動算出(従量 + 固定) + Σ台帳(payout_delta)
//
// 自動算出は「従量(course_unit_rates) + 固定(course_fixed_rates)」の加算。
// 既存実装（fixed>0 なら従量を無視する排他）とは異なり加算だが、
// 片方しか設定の無いコースでは結果は一致する（現データは全て片方のみ）。
// ============================================================

import type {
  Contribution,
  CourseFixedRate,
  CourseUnitRate,
  DailyReport,
  LedgerEntry,
  Money,
  UnitDef,
} from "./types";

export function zeroMoney(): Money {
  return { revenue: 0, profit: 0, payout: 0 };
}

export function addMoney(a: Money, b: Money): Money {
  return {
    revenue: a.revenue + b.revenue,
    profit: a.profit + b.profit,
    payout: a.payout + b.payout,
  };
}

/** 集計対象に含めてよい日報か（承認済み かつ 却下されていない） */
export function isCountableReport(r: DailyReport): boolean {
  return r.approvedAt != null && r.rejectedAt == null;
}

/** rate / unit の索引をまとめた計算コンテキスト */
export type AggregationContext = {
  /** unitId -> UnitDef */
  unitById: Map<string, UnitDef>;
  /** `${courseId}:${unitId}` -> CourseUnitRate */
  unitRateByCourseUnit: Map<string, CourseUnitRate>;
  /** courseId -> CourseFixedRate */
  fixedRateByCourse: Map<string, CourseFixedRate>;
};

export function buildContext(
  units: UnitDef[],
  unitRates: CourseUnitRate[],
  fixedRates: CourseFixedRate[],
): AggregationContext {
  const unitById = new Map<string, UnitDef>();
  units.forEach((u) => unitById.set(u.id, u));

  const unitRateByCourseUnit = new Map<string, CourseUnitRate>();
  unitRates.forEach((r) =>
    unitRateByCourseUnit.set(`${r.courseId}:${r.unitId}`, r),
  );

  const fixedRateByCourse = new Map<string, CourseFixedRate>();
  fixedRates.forEach((r) => fixedRateByCourse.set(r.courseId, r));

  return { unitById, unitRateByCourseUnit, fixedRateByCourse };
}

/** どの field が従量課金の数量かを引く */
function isBillableField(
  ctx: AggregationContext,
  unitId: string,
  fieldKey: string,
): boolean {
  const unit = ctx.unitById.get(unitId);
  if (!unit) return false;
  const f = unit.fields.find((x) => x.fieldKey === fieldKey);
  return !!f && f.isBillable;
}

/**
 * 1本の日報を Contribution 群に展開する。
 * - 従量: billable な report_entry ごとに value × course_unit_rate
 * - 固定: course_fixed_rate を 1 シフト 1 回
 * 集計対象外（未承認/却下）や courseId 不明の場合は空配列。
 */
export function reportContributions(
  report: DailyReport,
  ctx: AggregationContext,
): Contribution[] {
  if (!isCountableReport(report)) return [];
  const courseId = report.courseId;
  if (!courseId) return []; // コース不明は自動算出できない
  const out: Contribution[] = [];

  // --- 従量分 ---
  for (const e of report.entries) {
    if (!isBillableField(ctx, e.unitId, e.fieldKey)) continue;
    const rate = ctx.unitRateByCourseUnit.get(`${courseId}:${e.unitId}`);
    if (!rate) continue;
    const qty = e.valueNum ?? 0;
    if (qty === 0) continue;
    out.push({
      date: report.reportDate,
      driverId: report.driverId,
      courseId,
      carrierId: report.carrierId,
      unitId: e.unitId,
      counterpartyId: null,
      source: "auto_per_piece",
      revenue: qty * rate.revenuePerUnit,
      profit: qty * rate.profitPerUnit,
      payout: qty * rate.payoutPerUnit,
    });
  }

  // --- 固定(日当)分 ---
  const fx = ctx.fixedRateByCourse.get(courseId);
  if (fx && (fx.fixedRevenue !== 0 || fx.fixedProfit !== 0 || fx.fixedPayout !== 0)) {
    out.push({
      date: report.reportDate,
      driverId: report.driverId,
      courseId,
      carrierId: report.carrierId,
      unitId: null,
      counterpartyId: null,
      source: "auto_fixed",
      revenue: fx.fixedRevenue,
      profit: fx.fixedProfit,
      payout: fx.fixedPayout,
    });
  }

  return out;
}

/** 台帳エントリを Contribution に変換 */
export function ledgerContributions(ledger: LedgerEntry[]): Contribution[] {
  return ledger.map((l) => ({
    date: l.entryDate,
    driverId: l.targetDriverId,
    courseId: l.courseId,
    carrierId: null,
    unitId: null,
    counterpartyId: l.counterpartyInvoiceAddressId,
    source: "ledger" as const,
    revenue: l.revenueDelta,
    profit: l.profitDelta,
    payout: l.payoutDelta,
  }));
}

/** 日報群＋台帳群 → 全 Contribution（日付範囲などのフィルタは呼び出し側で） */
export function buildContributions(
  reports: DailyReport[],
  ledger: LedgerEntry[],
  ctx: AggregationContext,
): Contribution[] {
  const out: Contribution[] = [];
  for (const r of reports) out.push(...reportContributions(r, ctx));
  out.push(...ledgerContributions(ledger));
  return out;
}

/** 指定キーで Money を合算 */
export function sumBy(
  contribs: Contribution[],
  keyFn: (c: Contribution) => string | null,
): Map<string, Money> {
  const m = new Map<string, Money>();
  for (const c of contribs) {
    const key = keyFn(c);
    if (key == null) continue;
    const cur = m.get(key) ?? zeroMoney();
    m.set(key, {
      revenue: cur.revenue + c.revenue,
      profit: cur.profit + c.profit,
      payout: cur.payout + c.payout,
    });
  }
  return m;
}

/** 全体合計 */
export function total(contribs: Contribution[]): Money {
  return contribs.reduce(
    (acc, c) => ({
      revenue: acc.revenue + c.revenue,
      profit: acc.profit + c.profit,
      payout: acc.payout + c.payout,
    }),
    zeroMoney(),
  );
}

/** 日付範囲フィルタ（inclusive, YYYY-MM-DD の辞書順比較） */
export function inDateRange(
  contribs: Contribution[],
  start: string,
  end: string,
): Contribution[] {
  return contribs.filter((c) => c.date >= start && c.date <= end);
}
