// ============================================================
// 集計ユーティリティの検証スクリプト（依存追加なし・tsx で実行）
//   npx tsx src/scripts/check-aggregation.ts
// 合成データで、従量/固定/加算/台帳/承認フィルタ/軸別合算 を検証する。
// ============================================================

import assert from "node:assert";
import {
  buildContext,
  buildContributions,
  inDateRange,
  reportContributions,
  sumBy,
  total,
} from "../server/aggregation/compute";
import type {
  CourseFixedRate,
  CourseUnitRate,
  DailyReport,
  LedgerEntry,
  UnitDef,
} from "../server/aggregation/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// --- 合成マスタ -------------------------------------------------
const CARRIER_Y = "carrier-yamato";
const CARRIER_A = "carrier-amazon";

const units: UnitDef[] = [
  {
    id: "u-takkyu",
    carrierId: CARRIER_Y,
    code: "TAKUHAIBIN",
    billingType: "PER_PIECE",
    fields: [
      { fieldKey: "completed", isBillable: true },
      { fieldKey: "returned", isBillable: false },
    ],
  },
  {
    id: "u-nekopos",
    carrierId: CARRIER_Y,
    code: "NEKOPOS",
    billingType: "PER_PIECE",
    fields: [
      { fieldKey: "completed", isBillable: true },
      { fieldKey: "returned", isBillable: false },
    ],
  },
  {
    id: "u-amazon",
    carrierId: CARRIER_A,
    code: "AMAZON_DELIVERY",
    billingType: "FIXED",
    fields: [
      { fieldKey: "am_completed", isBillable: false },
      { fieldKey: "pm_completed", isBillable: false },
    ],
  },
];

// コース: 純従量(C1) / 純固定(C2 Amazon) / 混在(C3 ヤマト歩合+日当)
const C1 = "course-yamato-perpiece";
const C2 = "course-amazon-fixed";
const C3 = "course-yamato-mixed";

const unitRates: CourseUnitRate[] = [
  { courseId: C1, unitId: "u-takkyu", revenuePerUnit: 160, profitPerUnit: 10, payoutPerUnit: 150 },
  { courseId: C1, unitId: "u-nekopos", revenuePerUnit: 40, profitPerUnit: 10, payoutPerUnit: 30 },
  // 混在コースも従量単価を持つ
  { courseId: C3, unitId: "u-takkyu", revenuePerUnit: 160, profitPerUnit: 10, payoutPerUnit: 150 },
];

const fixedRates: CourseFixedRate[] = [
  { courseId: C2, fixedRevenue: 10000, fixedProfit: 4000, fixedPayout: 6000 },
  // 混在コース: 日当も持つ（従量と加算される）
  { courseId: C3, fixedRevenue: 5000, fixedProfit: 2000, fixedPayout: 3000 },
];

const ctx = buildContext(units, unitRates, fixedRates);

function rep(over: Partial<DailyReport> & { id: string }): DailyReport {
  return {
    driverId: "d1",
    reportDate: "2026-05-10",
    courseId: C1,
    carrierId: CARRIER_Y,
    approvedAt: "2026-05-11T00:00:00Z",
    rejectedAt: null,
    entries: [],
    ...over,
  };
}

// --- テスト -----------------------------------------------------
console.log("aggregation compute checks:");

check("従量: 完了個数×単価のみ（持戻は非課金）", () => {
  const r = rep({
    id: "r1",
    courseId: C1,
    entries: [
      { unitId: "u-takkyu", fieldKey: "completed", valueNum: 100 },
      { unitId: "u-takkyu", fieldKey: "returned", valueNum: 5 },
      { unitId: "u-nekopos", fieldKey: "completed", valueNum: 50 },
    ],
  });
  const t = total(reportContributions(r, ctx));
  // 宅急便 100*160 + ネコポス 50*40 = 16000 + 2000 = 18000
  assert.strictEqual(t.revenue, 18000);
  assert.strictEqual(t.profit, 100 * 10 + 50 * 10); // 1500
  assert.strictEqual(t.payout, 100 * 150 + 50 * 30); // 16500
});

check("固定: Amazon配送は報告値に関わらず1シフト固定額", () => {
  const r = rep({
    id: "r2",
    courseId: C2,
    carrierId: CARRIER_A,
    entries: [
      { unitId: "u-amazon", fieldKey: "am_completed", valueNum: 80 },
      { unitId: "u-amazon", fieldKey: "pm_completed", valueNum: 70 },
    ],
  });
  const t = total(reportContributions(r, ctx));
  assert.deepStrictEqual(t, { revenue: 10000, profit: 4000, payout: 6000 });
});

check("混在: 従量 + 日当 が加算される（下京パターン）", () => {
  const r = rep({
    id: "r3",
    courseId: C3,
    entries: [{ unitId: "u-takkyu", fieldKey: "completed", valueNum: 30 }],
  });
  const t = total(reportContributions(r, ctx));
  // 歩合 30*160=4800 + 日当 5000 = 9800
  assert.strictEqual(t.revenue, 4800 + 5000);
  assert.strictEqual(t.profit, 30 * 10 + 2000);
  assert.strictEqual(t.payout, 30 * 150 + 3000);
});

check("未承認・却下の日報は集計対象外", () => {
  const notApproved = rep({ id: "r4", approvedAt: null, entries: [{ unitId: "u-takkyu", fieldKey: "completed", valueNum: 10 }] });
  const rejected = rep({ id: "r5", rejectedAt: "2026-05-12T00:00:00Z", entries: [{ unitId: "u-takkyu", fieldKey: "completed", valueNum: 10 }] });
  assert.strictEqual(reportContributions(notApproved, ctx).length, 0);
  assert.strictEqual(reportContributions(rejected, ctx).length, 0);
});

check("台帳: 3 delta がそのまま反映（手当はpayoutプラス・控除はマイナス）", () => {
  const ledger: LedgerEntry[] = [
    { entryDate: "2026-05-15", revenueDelta: 20000, profitDelta: 8000, payoutDelta: 0, targetDriverId: null, courseId: null, counterpartyInvoiceAddressId: "cp1" },
    { entryDate: "2026-05-20", revenueDelta: 0, profitDelta: 0, payoutDelta: 12000, targetDriverId: "d1", courseId: null, counterpartyInvoiceAddressId: null }, // 手当
    { entryDate: "2026-05-25", revenueDelta: 0, profitDelta: 0, payoutDelta: -3000, targetDriverId: "d1", courseId: null, counterpartyInvoiceAddressId: null }, // 控除
  ];
  const t = total(buildContributions([], ledger, ctx));
  assert.deepStrictEqual(t, { revenue: 20000, profit: 8000, payout: 9000 });
});

check("軸別合算: carrier別売上 / driver別支払 / counterparty別売上", () => {
  const reports: DailyReport[] = [
    rep({ id: "a", courseId: C1, carrierId: CARRIER_Y, entries: [{ unitId: "u-takkyu", fieldKey: "completed", valueNum: 100 }] }), // Yamato rev 16000
    rep({ id: "b", courseId: C2, carrierId: CARRIER_A, driverId: "d2", entries: [] }), // Amazon rev 10000 fixed
  ];
  const ledger: LedgerEntry[] = [
    { entryDate: "2026-05-15", revenueDelta: 5000, profitDelta: 1000, payoutDelta: 0, targetDriverId: null, courseId: null, counterpartyInvoiceAddressId: "cpX" },
    { entryDate: "2026-05-16", revenueDelta: 0, profitDelta: 0, payoutDelta: 2000, targetDriverId: "d2", courseId: null, counterpartyInvoiceAddressId: null },
  ];
  const all = buildContributions(reports, ledger, ctx);

  const byCarrier = sumBy(all, (c) => c.carrierId);
  assert.strictEqual(byCarrier.get(CARRIER_Y)!.revenue, 16000);
  assert.strictEqual(byCarrier.get(CARRIER_A)!.revenue, 10000);

  const byDriverPayout = sumBy(all, (c) => c.driverId);
  // d1: 宅急便 100*150 = 15000 ; d2: 固定 payout 6000 + 台帳 2000 = 8000
  assert.strictEqual(byDriverPayout.get("d1")!.payout, 15000);
  assert.strictEqual(byDriverPayout.get("d2")!.payout, 8000);

  const byCp = sumBy(all, (c) => c.counterpartyId);
  assert.strictEqual(byCp.get("cpX")!.revenue, 5000);
});

check("日付範囲フィルタ", () => {
  const reports: DailyReport[] = [
    rep({ id: "p1", reportDate: "2026-05-01", entries: [{ unitId: "u-takkyu", fieldKey: "completed", valueNum: 10 }] }),
    rep({ id: "p2", reportDate: "2026-06-01", entries: [{ unitId: "u-takkyu", fieldKey: "completed", valueNum: 10 }] }),
  ];
  const all = buildContributions(reports, [], ctx);
  const may = inDateRange(all, "2026-05-01", "2026-05-31");
  assert.strictEqual(total(may).revenue, 1600);
});

console.log(`\nAll ${passed} checks passed ✅`);
