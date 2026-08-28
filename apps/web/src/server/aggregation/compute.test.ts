import { describe, expect, it } from "vitest";
import { buildContext, buildContributions, reportContributions } from "./compute";
import type { CourseFixedRate, DailyReport } from "./types";

const EXCLUSIVE_BASES = {
  revenuePieceBasis: "exclusive",
  payoutPieceBasis: "exclusive",
  revenueFixedBasis: "exclusive",
  payoutFixedBasis: "exclusive",
} as const;

const report = (cycleNo: number): DailyReport => ({
  id: `r-${cycleNo}`,
  driverId: "d1",
  reportDate: "2026-08-21",
  courseId: "c1",
  cycleNo,
  carrierId: "carrier-1",
  approvedAt: "2026-08-21T00:00:00Z",
  rejectedAt: null,
  entries: [],
});

describe("便別固定単価", () => {
  it("便一致を優先し、未設定の便は全便共通へフォールバックする", () => {
    const fixedRates: CourseFixedRate[] = [
      { courseId: "c1", cycleNo: 0, fixedRevenue: 17_000, fixedProfit: 4_000, fixedPayout: 13_000 },
      { courseId: "c1", cycleNo: 1, fixedRevenue: 9_000, fixedProfit: 2_000, fixedPayout: 7_000 },
    ];
    const ctx = buildContext([], [], fixedRates);
    expect(reportContributions(report(1), ctx)[0].payout).toBe(7_000);
    expect(reportContributions(report(2), ctx)[0].payout).toBe(13_000);
  });

  it("承認時スナップショットを現在の単価より優先する", () => {
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 20_000, fixedProfit: 5_000, fixedPayout: 15_000 },
    ]);
    const approved = {
      ...report(1),
      rateSnapshot: {
        version: 1 as const,
        capturedAt: "2026-08-21T00:00:00Z",
        components: [{
          kind: "fixed" as const,
          unitId: null,
          quantity: 1,
          revenueContractAmount: 17_000,
          revenueBasis: "exclusive" as const,
          payoutContractAmount: 13_000,
          payoutBasis: "exclusive" as const,
          revenue: 17_000,
          payout: 13_000,
          profit: 4_000,
        }],
      },
    };
    expect(reportContributions(approved, ctx)[0]).toMatchObject({
      revenue: 17_000,
      payout: 13_000,
      profit: 4_000,
    });
  });

  it("全日単価は売上をコース単位、支払を同一ドライバー単位で便別合計から置き換える", () => {
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 10_000, fixedProfit: 3_000, fixedPayout: 7_000 },
      { courseId: "c1", cycleNo: 2, fixedRevenue: 10_000, fixedProfit: 3_000, fixedPayout: 7_000 },
    ], [{ courseId: "c1", requiredCycleNos: [1, 2], fixedRevenue: 22_000, fixedPayout: 15_000 }]);

    const contributions = buildContributions([report(1), report(2)], [], ctx);
    const total = contributions.reduce((sum, item) => ({
      revenue: sum.revenue + item.revenue,
      payout: sum.payout + item.payout,
      profit: sum.profit + item.profit,
    }), { revenue: 0, payout: 0, profit: 0 });
    expect(total).toEqual({ revenue: 22_000, payout: 15_000, profit: 7_000 });

    const splitDriver = { ...report(2), driverId: "d2" };
    const split = buildContributions([report(1), splitDriver], [], ctx);
    expect(split.reduce((sum, item) => sum + item.revenue, 0)).toBe(22_000);
    expect(split.reduce((sum, item) => sum + item.payout, 0)).toBe(14_000);
  });

  it("旧cycle_no=0日報の空スナップショットを全日単価で補完する", () => {
    const legacy = {
      ...report(0),
      rateSnapshot: {
        version: 1 as const,
        capturedAt: "2026-08-23T00:00:00Z",
        components: [],
        fixedBundle: {
          requiredCycleNos: [1, 2],
          fixedRevenue: 15_454,
          fixedPayout: 11_818,
        },
      },
    };
    const ctx = buildContext([], [], [], [{
      courseId: "c1",
      requiredCycleNos: [1, 2],
      fixedRevenue: 15_454,
      fixedPayout: 11_818,
    }]);

    expect(reportContributions(legacy, ctx)).toEqual([expect.objectContaining({
      source: "auto_fixed",
      revenue: 15_454,
      payout: 11_818,
      profit: 3_636,
    })]);
  });

  // 2026-08-27: 実態は「2人ともフル1日稼働」だったため、売上も人数分に改めた。
  // 旧仕様（売上はコース/日で1回だけ）は、支払だけ人数分残って利益がマイナスになっていた。
  it("旧cycle_no=0日報が同一コースに複数ある日は、売上・報酬とも人数分にする", () => {
    const snapshot = {
      version: 1 as const,
      capturedAt: "2026-08-23T00:00:00Z",
      components: [],
      fixedBundle: {
        requiredCycleNos: [1, 2],
        fixedRevenue: 15_454,
        fixedPayout: 11_818,
      },
    };
    const ctx = buildContext([], [], [], [{
      courseId: "c1",
      requiredCycleNos: [1, 2],
      fixedRevenue: 15_454,
      fixedPayout: 11_818,
    }]);
    const contributions = buildContributions([
      { ...report(0), id: "legacy-1", rateSnapshot: snapshot },
      { ...report(0), id: "legacy-2", driverId: "d2", rateSnapshot: snapshot },
    ], [], ctx);

    expect(contributions.reduce((sum, item) => sum + item.revenue, 0)).toBe(30_908);
    expect(contributions.reduce((sum, item) => sum + item.payout, 0)).toBe(23_636);
    expect(contributions.reduce((sum, item) => sum + item.profit, 0)).toBe(7_272);
  });
});

describe("数量条件付き従量単価", () => {
  it("日当と歩合は加算する", () => {
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 100 }],
    };
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 0, payoutPerUnit: 150, profitPerUnit: -150 }],
      [{ courseId: "c1", cycleNo: 1, fixedRevenue: 0, fixedProfit: -6_500, fixedPayout: 6_500 }],
    );
    expect(reportContributions(withEntry, ctx).reduce((sum, item) => sum + item.payout, 0)).toBe(21_500);
  });

  it("売上だけ最低100個、支払は実数で計算できる", () => {
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 80 }],
    };
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{
        courseId: "c1", cycleNo: 1, unitId: "u1",
        revenuePerUnit: 180, payoutPerUnit: 150, profitPerUnit: 30,
        revenueQuantityRule: { kind: "minimum", minimum: 100, scope: "report" },
        payoutQuantityRule: { kind: "actual" },
      }],
      [],
    );
    expect(reportContributions(withEntry, ctx)[0]).toMatchObject({
      revenue: 18_000,
      payout: 12_000,
      profit: 6_000,
    });
  });
});

describe("支払なしコース（payoutRateMode = NONE）", () => {
  const unit = {
    id: "u1", carrierId: "carrier-1", code: null,
    billingType: "PER_PIECE" as const, fields: [{ fieldKey: "count", isBillable: true }],
  };
  const withEntry: DailyReport = {
    ...report(1),
    entries: [{ unitId: "u1", fieldKey: "count", valueNum: 100 }],
  };

  it("単価行に旧支払が残っていても支払0・売上全額が自社利益になる", () => {
    const ctx = buildContext(
      [unit],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 157, payoutPerUnit: 136, profitPerUnit: 21 }],
      [{ courseId: "c1", cycleNo: 1, fixedRevenue: 17_000, fixedProfit: 5_182, fixedPayout: 11_818 }],
      [],
      [{ courseId: "c1", revenueRateMode: "BOTH", payoutRateMode: "NONE", ...EXCLUSIVE_BASES }],
    );
    const total = reportContributions(withEntry, ctx).reduce((sum, item) => ({
      revenue: sum.revenue + item.revenue,
      payout: sum.payout + item.payout,
      profit: sum.profit + item.profit,
    }), { revenue: 0, payout: 0, profit: 0 });
    expect(total).toEqual({ revenue: 32_700, payout: 0, profit: 32_700 });
  });

  it("承認時スナップショットの支払よりコースの支払なし設定を優先する", () => {
    const ctx = buildContext([], [], [], [], [
      { courseId: "c1", revenueRateMode: "FIXED", payoutRateMode: "NONE", ...EXCLUSIVE_BASES },
    ]);
    const approved = {
      ...report(1),
      rateSnapshot: {
        version: 1 as const,
        capturedAt: "2026-08-21T00:00:00Z",
        components: [{
          kind: "fixed" as const,
          unitId: null,
          quantity: 1,
          revenueContractAmount: 17_000,
          revenueBasis: "exclusive" as const,
          payoutContractAmount: 13_000,
          payoutBasis: "exclusive" as const,
          revenue: 17_000,
          payout: 13_000,
          profit: 4_000,
        }],
      },
    };
    expect(reportContributions(approved, ctx)[0]).toMatchObject({
      revenue: 17_000,
      payout: 0,
      profit: 17_000,
    });
  });

  it("方式を渡さない呼び出しは従来どおり単価行の値をそのまま使う", () => {
    const ctx = buildContext(
      [unit],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 157, payoutPerUnit: 136, profitPerUnit: 21 }],
      [],
    );
    expect(reportContributions(withEntry, ctx)[0]).toMatchObject({
      revenue: 15_700,
      payout: 13_600,
      profit: 2_100,
    });
  });
});

describe("小数の契約単価", () => {
  it("157.5円/個 × 100個 は行合計で丸めて 15,750円になる", () => {
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 157.5, payoutPerUnit: 136.25, profitPerUnit: 21.25 }],
      [],
    );
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 100 }],
    };
    expect(reportContributions(withEntry, ctx)[0]).toMatchObject({
      revenue: 15_750,
      payout: 13_625,
      profit: 2_125,
    });
  });

  it("行合計は円単位へ丸める（単価ごとに丸めない）", () => {
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 157.5, payoutPerUnit: 0, profitPerUnit: 157.5 }],
      [],
    );
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 3 }],
    };
    // 157.5 × 3 = 472.5 → 473（1個ずつ丸めた 158×3=474 にはしない）
    expect(reportContributions(withEntry, ctx)[0].revenue).toBe(473);
  });
});

describe("全日単価の成立回数", () => {
  const bundleCtx = () => buildContext([], [], [
    { courseId: "c1", cycleNo: 0, fixedRevenue: 15_454, fixedProfit: 3_636, fixedPayout: 11_818 },
    { courseId: "c1", cycleNo: 1, fixedRevenue: 7_727, fixedProfit: 1_818, fixedPayout: 5_909 },
    { courseId: "c1", cycleNo: 2, fixedRevenue: 7_727, fixedProfit: 1_818, fixedPayout: 5_909 },
  ], [{ courseId: "c1", requiredCycleNos: [1, 2], fixedRevenue: 15_454, fixedPayout: 11_818 }]);

  const sum = (contributions: ReturnType<typeof buildContributions>) => contributions.reduce((acc, item) => ({
    revenue: acc.revenue + item.revenue,
    payout: acc.payout + item.payout,
    profit: acc.profit + item.profit,
  }), { revenue: 0, payout: 0, profit: 0 });

  it("2人がそれぞれ全便を走った日は全日単価を2回分計上する", () => {
    const a = { ...report(1), driverId: "d1" };
    const a2 = { ...report(2), id: "r-1b", driverId: "d1" };
    const b = { ...report(1), id: "r-2a", driverId: "d2" };
    const b2 = { ...report(2), id: "r-2b", driverId: "d2" };
    expect(sum(buildContributions([a, a2, b, b2], [], bundleCtx()))).toEqual({
      revenue: 30_908, payout: 23_636, profit: 7_272,
    });
  });

  it("C1とC2を2人で分担した日は全日単価1回分に収まる", () => {
    const a = { ...report(1), driverId: "d1" };
    const b = { ...report(2), id: "r-2", driverId: "d2" };
    expect(sum(buildContributions([a, b], [], bundleCtx()))).toEqual({
      revenue: 15_454, payout: 11_818, profit: 3_636,
    });
  });

  it("サイクル導入前のcycle_no=0の日報は1本＝全日1回。2人分なら売上も支払も2回分", () => {
    const a = { ...report(0), id: "r-a", driverId: "d1" };
    const b = { ...report(0), id: "r-b", driverId: "d2" };
    // 旧cycle_no=0の日当行（15,454 / 11,818）が各日報に付き、全日単価と一致するため差分は出ない
    expect(sum(buildContributions([a, b], [], bundleCtx()))).toEqual({
      revenue: 30_908, payout: 23_636, profit: 7_272,
    });
  });

  it("cycle_no=0と便別日報が混在する日も、全日成立の回数で数える", () => {
    const legacy = { ...report(0), id: "r-legacy", driverId: "d1" };
    const c1 = { ...report(1), id: "r-c1", driverId: "d2" };
    const c2 = { ...report(2), id: "r-c2", driverId: "d3" };
    // 全日成立2回（旧日報1 + 便別1セット）
    expect(sum(buildContributions([legacy, c1, c2], [], bundleCtx()))).toEqual({
      revenue: 30_908, payout: 23_636, profit: 7_272,
    });
  });

  it("片方の便しか報告が無い日は全日単価を当てない", () => {
    const c1 = { ...report(1), id: "r-c1", driverId: "d1" };
    expect(sum(buildContributions([c1], [], bundleCtx()))).toEqual({
      revenue: 7_727, payout: 5_909, profit: 1_818,
    });
  });
});

describe("税込表示（契約原額から積み直す）", () => {
  const INCLUSIVE_FIXED = {
    revenuePieceBasis: "exclusive",
    payoutPieceBasis: "exclusive",
    revenueFixedBasis: "inclusive",
    payoutFixedBasis: "inclusive",
  } as const;

  it("税込契約の日当は、税抜値の1.1倍ではなく契約額そのものを税込として返す", () => {
    // 税込17,000円契約 → 保存は税抜15,454円（切り捨て）。15,454×1.1=16,999 で契約額に戻らない
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 15_454, fixedProfit: 3_636, fixedPayout: 11_818,
        revenueContractAmount: 17_000, payoutContractAmount: 13_000 },
    ], [], [{ courseId: "c1", revenueRateMode: "FIXED", payoutRateMode: "FIXED", ...INCLUSIVE_FIXED }]);
    const [contribution] = reportContributions(report(1), ctx);
    expect(contribution.revenue).toBe(15_454);
    expect(contribution.revenueIncl).toBe(17_000);
    expect(contribution.payoutIncl).toBe(13_000);
    expect(contribution.profitIncl).toBe(4_000);
  });

  it("税抜契約は税込を四捨五入で導出する", () => {
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 10_000, fixedProfit: 4_000, fixedPayout: 6_000,
        revenueContractAmount: 10_000, payoutContractAmount: 6_000 },
    ], [], [{ courseId: "c1", revenueRateMode: "FIXED", payoutRateMode: "FIXED", ...EXCLUSIVE_BASES }]);
    const [contribution] = reportContributions(report(1), ctx);
    expect(contribution.revenueIncl).toBe(11_000);
    expect(contribution.payoutIncl).toBe(6_600);
  });

  it("契約原額が無い旧データは税抜値の1.1倍で近似する", () => {
    const ctx = buildContext([], [], [
      { courseId: "c1", cycleNo: 1, fixedRevenue: 10_000, fixedProfit: 4_000, fixedPayout: 6_000 },
    ], [], [{ courseId: "c1", revenueRateMode: "FIXED", payoutRateMode: "FIXED", ...EXCLUSIVE_BASES }]);
    const [contribution] = reportContributions(report(1), ctx);
    expect(contribution.revenueIncl).toBe(11_000);
  });

  it("歩合は契約単価×数量を先に掛けてから税換算する（1個ずつ丸めない）", () => {
    const ctx = buildContext(
      [{ id: "u1", carrierId: "carrier-1", code: null, billingType: "PER_PIECE", fields: [{ fieldKey: "count", isBillable: true }] }],
      [{ courseId: "c1", cycleNo: 1, unitId: "u1", revenuePerUnit: 136, payoutPerUnit: 0, profitPerUnit: 136,
        revenueContractAmount: 150, payoutContractAmount: 0 }],
      [], [],
      [{ courseId: "c1", revenueRateMode: "PER_PIECE", payoutRateMode: "NONE",
        revenuePieceBasis: "inclusive", payoutPieceBasis: "inclusive",
        revenueFixedBasis: "exclusive", payoutFixedBasis: "exclusive" }],
    );
    const withEntry: DailyReport = {
      ...report(1),
      entries: [{ unitId: "u1", fieldKey: "count", valueNum: 100 }],
    };
    const [contribution] = reportContributions(withEntry, ctx);
    // 税込150円 × 100個 = 15,000円（136×100=13,600 の 1.1倍 14,960 とは一致しない）
    expect(contribution.revenueIncl).toBe(15_000);
  });
});

describe("旧cycle_no=0と全日日当の対応", () => {
  // 2026-08-28: 旧 cycle_no=0 の日当行を削除したところ、集計は全日日当が補完して±0だったが
  // 請求明細には全日日当の処理が無く、上鳥羽・豊中の86万円が明細から丸ごと消えた。
  // 集計側は「便別行が無くても全日日当で計上する」ことをここで固定する。
  const ctx = () => buildContext([], [], [], [
    { courseId: "c1", requiredCycleNos: [1, 2], fixedRevenue: 15_454, fixedPayout: 11_818,
      revenueContractAmount: 17_000, payoutContractAmount: 11_818 },
  ], [{ courseId: "c1", revenueRateMode: "FIXED", payoutRateMode: "FIXED",
    revenuePieceBasis: "exclusive", payoutPieceBasis: "exclusive",
    revenueFixedBasis: "inclusive", payoutFixedBasis: "exclusive" }]);

  it("便別の日当行が無くても、cycle_no=0の日報は全日日当で計上する", () => {
    const contributions = buildContributions([report(0)], [], ctx());
    const revenue = contributions.reduce((s, x) => s + x.revenue, 0);
    const payout = contributions.reduce((s, x) => s + x.payout, 0);
    expect(revenue).toBe(15_454);
    expect(payout).toBe(11_818);
  });

  it("cycle_no=0が2人分あれば全日日当も2回分になる", () => {
    const a = { ...report(0), id: "r-a", driverId: "d1" };
    const b = { ...report(0), id: "r-b", driverId: "d2" };
    const contributions = buildContributions([a, b], [], ctx());
    expect(contributions.reduce((s, x) => s + x.revenue, 0)).toBe(30_908);
    expect(contributions.reduce((s, x) => s + x.payout, 0)).toBe(23_636);
  });

  it("計上額は必ず円単位（全日日当が小数でも小数円を出さない）", () => {
    const decimalCtx = buildContext([], [], [], [
      { courseId: "c1", requiredCycleNos: [1, 2], fixedRevenue: 15_454.55, fixedPayout: 11_818,
        revenueContractAmount: 17_000, payoutContractAmount: 11_818 },
    ], [{ courseId: "c1", revenueRateMode: "FIXED", payoutRateMode: "FIXED",
      revenuePieceBasis: "exclusive", payoutPieceBasis: "exclusive",
      revenueFixedBasis: "inclusive", payoutFixedBasis: "exclusive" }]);
    const contributions = buildContributions([report(0)], [], decimalCtx);
    contributions.forEach((x) => {
      expect(Number.isInteger(x.revenue)).toBe(true);
      expect(Number.isInteger(x.payout)).toBe(true);
      expect(Number.isInteger(x.revenueIncl)).toBe(true);
    });
  });
});
