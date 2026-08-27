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
  CourseFixedRateBundle,
  CourseRateModes,
  CourseUnitRate,
  DailyReport,
  LedgerEntry,
  Money,
  RateMode,
  UnitDef,
} from "./types";
import { applyQuantityRule } from "@/server/billing/quantityRule";

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
  /** `${courseId}:${cycleNo}:${unitId}` -> CourseUnitRate */
  unitRateByCourseUnit: Map<string, CourseUnitRate>;
  /** `${courseId}:${cycleNo}` -> CourseFixedRate */
  fixedRateByCourse: Map<string, CourseFixedRate>;
  fixedBundleByCourse: Map<string, CourseFixedRateBundle>;
  /** courseId -> 売上/支払の計算方式。未登録は BOTH（＝単価行の値をそのまま使う従来挙動） */
  rateModeByCourse: Map<string, { revenue: RateMode; payout: RateMode }>;
};

/**
 * コース単価は「計算方式(NONE/PER_PIECE/FIXED/BOTH)」が正本。
 * 方式から外れた単価行（例: 自動支払なしのコースに残った旧支払単価）は 0 として扱う。
 * これにより「支払なし」のコースは支払0＝売上全額が自社利益として売上ページへ載る。
 */
const allowsPiece = (mode: RateMode) => mode === "PER_PIECE" || mode === "BOTH";
const allowsFixed = (mode: RateMode) => mode === "FIXED" || mode === "BOTH";
const DEFAULT_RATE_MODES = { revenue: "BOTH" as RateMode, payout: "BOTH" as RateMode };

export function buildContext(
  units: UnitDef[],
  unitRates: CourseUnitRate[],
  fixedRates: CourseFixedRate[],
  fixedBundles: CourseFixedRateBundle[] = [],
  courseRateModes: CourseRateModes[] = [],
): AggregationContext {
  const unitById = new Map<string, UnitDef>();
  units.forEach((u) => unitById.set(u.id, u));

  const unitRateByCourseUnit = new Map<string, CourseUnitRate>();
  unitRates.forEach((r) =>
    unitRateByCourseUnit.set(`${r.courseId}:${r.cycleNo ?? 0}:${r.unitId}`, r),
  );

  const fixedRateByCourse = new Map<string, CourseFixedRate>();
  fixedRates.forEach((r) => fixedRateByCourse.set(`${r.courseId}:${r.cycleNo ?? 0}`, r));

  const fixedBundleByCourse = new Map(fixedBundles.map((bundle) => [bundle.courseId, bundle]));
  const rateModeByCourse = new Map(
    courseRateModes.map((m) => [m.courseId, { revenue: m.revenueRateMode, payout: m.payoutRateMode }]),
  );
  return { unitById, unitRateByCourseUnit, fixedRateByCourse, fixedBundleByCourse, rateModeByCourse };
}

/** コースの計算方式を引く（未登録＝従来挙動の BOTH） */
export function rateModesOf(ctx: AggregationContext, courseId: string) {
  return ctx.rateModeByCourse.get(courseId) ?? DEFAULT_RATE_MODES;
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

  const modes = rateModesOf(ctx, courseId);

  // 承認時スナップショットがあれば現在の単価マスタより優先する。
  // これにより、後日の単価変更で承認済み期間の売上・報酬・粗利が動かない。
  // ただし「契約そのものが無い(NONE)」はコース属性であり単価改定とは別軸のため、
  // スナップショットより優先して 0 にする（支払なし → 売上全額が自社利益）。
  if (report.rateSnapshot?.version === 1) {
    return report.rateSnapshot.components.map((component) => {
      const piece = component.kind === "unit";
      const revenue = (piece ? allowsPiece(modes.revenue) : allowsFixed(modes.revenue)) ? component.revenue : 0;
      const payout = (piece ? allowsPiece(modes.payout) : allowsFixed(modes.payout)) ? component.payout : 0;
      return {
        date: report.reportDate,
        driverId: report.driverId,
        courseId,
        carrierId: report.carrierId,
        unitId: component.unitId,
        counterpartyId: null,
        source: (piece ? "auto_per_piece" : "auto_fixed") as Contribution["source"],
        revenue,
        payout,
        profit: revenue - payout,
      };
    });
  }

  // --- 従量分 ---
  for (const e of report.entries) {
    if (!isBillableField(ctx, e.unitId, e.fieldKey)) continue;
    const rate =
      ctx.unitRateByCourseUnit.get(`${courseId}:${report.cycleNo ?? 0}:${e.unitId}`) ??
      ctx.unitRateByCourseUnit.get(`${courseId}:0:${e.unitId}`);
    if (!rate) continue;
    const actualQty = e.valueNum ?? 0;
    if (actualQty === 0) continue;
    const revenueQty = applyQuantityRule(actualQty, rate.revenueQuantityRule);
    const payoutQty = applyQuantityRule(actualQty, rate.payoutQuantityRule);
    // 単価は小数を許す（例: 157.5円/個）。円未満は行合計で一度だけ丸める。
    const revenue = allowsPiece(modes.revenue) ? Math.round(revenueQty * rate.revenuePerUnit) : 0;
    const payout = allowsPiece(modes.payout) ? Math.round(payoutQty * rate.payoutPerUnit) : 0;
    if (revenue === 0 && payout === 0) continue;
    out.push({
      date: report.reportDate,
      driverId: report.driverId,
      courseId,
      carrierId: report.carrierId,
      unitId: e.unitId,
      counterpartyId: null,
      source: "auto_per_piece",
      revenue,
      profit: revenue - payout,
      payout,
    });
  }

  // --- 固定(日当)分 ---
  const fx =
    ctx.fixedRateByCourse.get(`${courseId}:${report.cycleNo ?? 0}`) ??
    ctx.fixedRateByCourse.get(`${courseId}:0`);
  if (fx) {
    // 保存済みの fixed_profit ではなく売上−支払で導出する。方式がNONEの側は0。
    const revenue = allowsFixed(modes.revenue) ? Math.round(fx.fixedRevenue) : 0;
    const payout = allowsFixed(modes.payout) ? Math.round(fx.fixedPayout) : 0;
    if (revenue !== 0 || payout !== 0) {
      out.push({
        date: report.reportDate,
        driverId: report.driverId,
        courseId,
        carrierId: report.carrierId,
        unitId: null,
        counterpartyId: null,
        source: "auto_fixed",
        revenue,
        payout,
        profit: revenue - payout,
      });
    }
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
  applyFixedBundleAdjustments(reports, out, ctx);
  out.push(...ledgerContributions(ledger));
  return out;
}

function hasAllCycles(reports: DailyReport[], required: number[]): boolean {
  const actual = new Set(reports.filter(isCountableReport).map((report) => report.cycleNo ?? 0));
  return required.length > 1 && required.every((cycleNo) => actual.has(cycleNo));
}

/** 全日単価は便別固定額の「追加」ではなく置換。売上はコース/日、支払はドライバー/コース/日で判定する。 */
function applyFixedBundleAdjustments(reports: DailyReport[], out: Contribution[], ctx: AggregationContext): void {
  const courseDays = new Map<string, DailyReport[]>();
  for (const report of reports) {
    if (!isCountableReport(report) || !report.courseId) continue;
    const key = `${report.reportDate}:${report.courseId}`;
    courseDays.set(key, [...(courseDays.get(key) ?? []), report]);
  }

  for (const [key, dayReports] of courseDays) {
    const courseId = dayReports[0].courseId!;
    const snapshotBundle = dayReports.find((report) => report.rateSnapshot?.fixedBundle)?.rateSnapshot?.fixedBundle;
    const bundle = snapshotBundle ? { courseId, ...snapshotBundle } : ctx.fixedBundleByCourse.get(courseId);
    if (!bundle || !hasAllCycles(dayReports, bundle.requiredCycleNos)) continue;
    const [date] = key.split(":");
    const modes = rateModesOf(ctx, courseId);

    if (bundle.fixedRevenue != null && allowsFixed(modes.revenue)) {
      const baseRevenue = out.filter((item) => item.date === date && item.courseId === courseId && item.source === "auto_fixed")
        .reduce((sum, item) => sum + item.revenue, 0);
      const revenueDelta = bundle.fixedRevenue - baseRevenue;
      if (revenueDelta !== 0) out.push({
        date, courseId, driverId: null, carrierId: dayReports[0].carrierId, unitId: null, counterpartyId: null,
        source: "auto_fixed", revenue: revenueDelta, payout: 0, profit: revenueDelta,
      });
    }

    if (bundle.fixedPayout != null && allowsFixed(modes.payout)) {
      const byDriver = new Map<string, DailyReport[]>();
      dayReports.forEach((report) => byDriver.set(report.driverId, [...(byDriver.get(report.driverId) ?? []), report]));
      for (const [driverId, driverReports] of byDriver) {
        if (!hasAllCycles(driverReports, bundle.requiredCycleNos)) continue;
        const basePayout = out.filter((item) => item.date === date && item.courseId === courseId && item.driverId === driverId && item.source === "auto_fixed")
          .reduce((sum, item) => sum + item.payout, 0);
        const payoutDelta = bundle.fixedPayout - basePayout;
        if (payoutDelta !== 0) out.push({
          date, courseId, driverId, carrierId: driverReports[0].carrierId, unitId: null, counterpartyId: null,
          source: "auto_fixed", revenue: 0, payout: payoutDelta, profit: -payoutDelta,
        });
      }
    }
  }
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
