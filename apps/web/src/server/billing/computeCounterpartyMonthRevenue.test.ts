import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAggregationData } from "../aggregation/load";
import { computeCounterpartyMonthBillingDetail } from "./computeCounterpartyMonthRevenue";
import { buildCounterpartyBillingSnapshot } from "./counterpartyBillingSnapshot";
import { computeInvoiceTotals } from "@repo/core/logic/reward";
import { buildCounterpartyDraft } from "./invoiceDraft";
import type { DailyReport } from "../aggregation/types";

vi.mock("../aggregation/load", () => ({ loadAggregationData: vi.fn() }));
let sequence = 0;
const report = (cycleNo: number, overrides: Partial<DailyReport> = {}): DailyReport => ({
  id: `report-${++sequence}`, reportDate: "2026-08-30", courseId: "course", driverId: "driver", cycleNo,
  carrierId: "carrier", approvedAt: "2026-08-31", rejectedAt: null, entries: [], ...overrides,
});
const data = () => ({
  carriers: [], units: [], unitRates: [], ledger: [],
  reports: [report(0), report(1), report(2), report(1, { reportDate: "2026-08-31" }),
    report(2, { reportDate: "2026-08-31", driverId: "other-driver" }),
    report(1, { courseId: "foreign-course" }), report(2, { courseId: "foreign-course" })],
  fixedRates: [1, 2].map((cycleNo) => ({ courseId: "course", cycleNo, fixedRevenue: 7727, fixedProfit: 1818, fixedPayout: 5909, revenueContractAmount: 8500 })),
  fixedRateBundles: [{ courseId: "course", requiredCycleNos: [1, 2], fixedRevenue: 15454, fixedPayout: 11818, revenueContractAmount: 17000 }],
  courseBillingMeta: [{ courseId: "course", revenueRateMode: "FIXED" as const, payoutRateMode: "FIXED" as const,
    revenuePieceBasis: "inclusive" as const, payoutPieceBasis: "exclusive" as const,
    revenueFixedBasis: "inclusive" as const, payoutFixedBasis: "exclusive" as const }],
});
function database(extraTables: Record<string, Record<string, unknown>[]> = {}, errors: Record<string, string> = {}) {
  const calls: Array<[string, string, unknown]> = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    courses: [
      { id: "course", name: "架空配送", org_id: "company", counterparty_invoice_address_id: "client", sort_order: 1, revenue_fixed_tax_basis: "inclusive" },
      { id: "foreign-course", name: "別会社の配送", org_id: "foreign-company", counterparty_invoice_address_id: "client", sort_order: 2 },
    ],
    drivers: [{ id: "driver", name: "架空 太郎", org_id: "company" }, { id: "other-driver", name: "架空 花子", org_id: "company" }],
    units: [], invoice_addresses: [{ id: "client", name: "架空取引先", org_id: "company" }],
    ...extraTables,
  };
  const client = { from(table: string) {
    let rows = tables[table] ?? [];
    const query = {
      select() { return query; },
      eq(column: string, value: unknown) { calls.push([table, column, value]); rows = rows.filter((r) => r[column] === value); return query; },
      in(column: string, values: unknown[]) { rows = rows.filter((r) => values.includes(r[column])); return query; },
      order() { return query; }, like() { return query; }, limit() { return query; },
      gte(column: string, value: string) { rows = rows.filter((r) => String(r[column]) >= value); return query; },
      lte(column: string, value: string) { rows = rows.filter((r) => String(r[column]) <= value); return query; },
      range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve: (value: { data: Record<string, unknown>[]; error: unknown }) => unknown) { return Promise.resolve(resolve({ data: rows, error: errors[table] ? { message: errors[table] } : null })); },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, calls };
}
beforeEach(() => vi.mocked(loadAggregationData).mockResolvedValue(data()));

describe("取引先の全日請求明細", () => {
  it("会社・取引先境界を保ち、全日・別人の片便を独立行にする", async () => {
    const db = database();
    const result = await computeCounterpartyMonthBillingDetail(db.client, "company", "2026-08-01", "2026-08-31", "client");
    expect(result.systemLines.map((l) => ({ key: l.lineKey, quantity: l.quantity, price: l.unitPrice, basis: l.priceBasis, unit: l.unit }))).toEqual([
      { key: "fx:course:cycle:1:drv:driver", quantity: 1, price: 8500, basis: "inclusive", unit: "日" },
      { key: "fx:course:cycle:2:drv:other-driver", quantity: 1, price: 8500, basis: "inclusive", unit: "日" },
      { key: "fx:course:cycle:bundle:drv:driver", quantity: 1, price: 17000, basis: "inclusive", unit: "日" },
    ]);
    expect(result.systemLines.reduce((sum, line) => sum + line.amount, 0)).toBe(34000);
    expect(result.systemLines.find((line) => line.lineKey.includes("bundle"))?.label).toContain("全日");
    expect(db.calls).toContainEqual(["courses", "org_id", "company"]);
    expect(db.calls).toContainEqual(["courses", "counterparty_invoice_address_id", "client"]);
    expect(loadAggregationData).toHaveBeenCalledWith(db.client, "company", "2026-08-01", "2026-08-31", { courseIds: ["course"], withLedger: false });
  });
  it("生成下書きへ全日1日・税込単価と片便行を引き継ぐ", async () => {
    const db = database();
    const draft = await buildCounterpartyDraft(db.client, "company", "test", "client",
      { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31" }, "Amazon");
    expect(draft?.tableData.main).toHaveLength(3);
    expect(draft?.tableData.main.find((line) => line.title.includes("全日"))).toMatchObject({ qty: 1, price: 17000, priceBasis: "inclusive", unit: "日" });
    expect(draft?.displayBasis).toBe("inclusive");
    expect(draft?.tableData.deduct).toEqual([]);
  });
});


const fixedKey = (cycle: number | "bundle", driver = "driver") => `fx:course:cycle:${cycle}:drv:${driver}`;
const mergedTables = (cycles: Array<number | "bundle">, quantity: number, unitPrice = 8500) => ({
  counterparty_monthly_merged_lines: [{ id: "merge", org_id: "company", invoice_address_id: "client", month_yyyy_mm: "2026-08", description: "保存済みの手動統合", quantity, unit_price: unitPrice, sort_order: 1 }],
  counterparty_monthly_merged_line_sources: cycles.map((cycle) => ({ merged_line_id: "merge", source_line_key: fixedKey(cycle) })),
});
const mergeCases = [
  { name: "両便", cycles: [1, 2], reports: [report(1), report(2)], mergeQty: 2, mergePrice: 8500, keys: ["mg:merge"], raw: 17000, exclusive: 17000, inclusive: 18700 },
  { name: "片側だけ", cycles: [1], reports: [report(1), report(2)], mergeQty: 1, mergePrice: 8500, keys: [fixedKey(2), "mg:merge"], raw: 17000, exclusive: 16227, inclusive: 17850 },
  { name: "片側の統合に余剰便を含む", cycles: [1], reports: [report(1), report(1), report(2)], mergeQty: 2, mergePrice: 8500, keys: [fixedKey(2), "mg:merge"], raw: 25500, exclusive: 24727, inclusive: 27200 },
  { name: "両便の統合に余剰便を含む", cycles: [1, 2], reports: [report(1), report(1), report(2)], mergeQty: 3, mergePrice: 8500, keys: ["mg:merge"], raw: 25500, exclusive: 25500, inclusive: 28050 },
  { name: "別人の余剰便を残す", cycles: [1, 2], reports: [report(1), report(2), report(1, { driverId: "other-driver" })], mergeQty: 2, mergePrice: 8500, keys: [fixedKey(1, "other-driver"), "mg:merge"], raw: 25500, exclusive: 24727, inclusive: 27200 },
  { name: "既存全日だけの統合も新しい便別行を消さない", cycles: ["bundle"], reports: [report(0, { reportDate: "2026-08-29" }), report(1), report(2)], mergeQty: 1, mergePrice: 17000, keys: [fixedKey(1), fixedKey(2), "mg:merge"], raw: 34000, exclusive: 32454, inclusive: 35700 },
] as const;

describe("保存済み手動統合の互換性", () => {
  for (const scenario of mergeCases) {
    it(`手動統合: ${scenario.name}は元キー・数量・従来金額を保つ`, async () => {
      vi.mocked(loadAggregationData).mockResolvedValue({ ...data(), reports: [...scenario.reports] });
      const db = database(mergedTables([...scenario.cycles], scenario.mergeQty, scenario.mergePrice));
      const snapshot = await buildCounterpartyBillingSnapshot(db.client, "company", "test", "client", "2026-08-01", "2026-08-31", "2026-08");
      expect(snapshot.mainLines.map((line) => line.lineKey)).toEqual(scenario.keys);
      expect(snapshot.mainSubtotal).toBe(scenario.raw);
      const draft = await buildCounterpartyDraft(db.client, "company", "test", "client",
        { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31" }, "Amazon");
      expect(draft!.tableData.main.reduce((sum, line) => sum + Math.round(line.qty * line.price), 0)).toBe(scenario.raw);
      for (const basis of ["exclusive", "inclusive"] as const) {
        const totals = computeInvoiceTotals({ main: draft!.tableData.main, deduct: [], taxEnabled: false, taxRatePercent: 10, displayBasis: basis, loanRepay: 0, extraOutsourcing: 0 });
        expect(totals.total).toBe(scenario[basis]);
      }
    });
  }
  it("会社・取引先・対象月外の統合元では自動全日を抑止しない", async () => {
    vi.mocked(loadAggregationData).mockResolvedValue({ ...data(), reports: [report(1), report(2)] });
    for (const override of [{ org_id: "foreign-company" }, { invoice_address_id: "other-client" }, { month_yyyy_mm: "2026-07" }, { month_yyyy_mm: "2026-09" }]) {
      const tables = mergedTables([1], 1);
      const db = database({ ...tables, counterparty_monthly_merged_lines: [{ ...tables.counterparty_monthly_merged_lines[0], ...override }] });
      const result = await computeCounterpartyMonthBillingDetail(db.client, "company", "2026-08-01", "2026-08-31", "client");
      expect(result.systemLines.map((line) => line.lineKey)).toEqual([fixedKey("bundle")]);
      expect(result.systemLines[0].amount).toBe(17000);
    }
  });
  it("手動統合元の取得失敗では全日へ振り替えずエラーで止まる", async () => {
    const db = database(mergedTables([1, 2], 2), { counterparty_monthly_merged_line_sources: "merge source failed" });
    await expect(computeCounterpartyMonthBillingDetail(db.client, "company", "2026-08-01", "2026-08-31", "client"))
      .rejects.toMatchObject({ message: "merge source failed" });
  });
});
