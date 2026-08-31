import { describe, expect, it } from "vitest";
import { indexShiftLeases, shiftLeaseMode, shiftLeaseGroups, type ShiftLease } from "./shiftLease";

const lease = (patch: Partial<ShiftLease> = {}): ShiftLease => ({ id: "a", driver_id: "d1", mode: "DAILY", valid_from: "2026-08-01", valid_to: "2026-08-31", ...patch });
describe("シフトに表示する契約区分", () => {
  it("開始・終了日は契約内、翌月から新しい区分になり、開始前や終了後はリースなし", () => {
    const index = indexShiftLeases([lease(), lease({ id: "b", mode: "MONTHLY", valid_from: "2026-09-01", valid_to: "2026-09-30" })]);
    expect(["2026-07-31", "2026-08-01", "2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"].map(date => shiftLeaseMode(index, "d1", date)))
      .toEqual(["NONE", "DAILY", "DAILY", "MONTHLY", "MONTHLY", "NONE"]);
    expect(shiftLeaseMode(index, "other", "2026-09-01")).toBe("NONE");
  });
  it("重複履歴は契約設定APIと同じ開始日降順・ID昇順で決定する", () => {
    const rows = [lease({ valid_to: null }), lease({ id: "c", mode: "DAILY", valid_from: "2026-09-01", valid_to: null }), lease({ id: "b", mode: "MONTHLY", valid_from: "2026-09-01", valid_to: null })];
    expect(shiftLeaseMode(indexShiftLeases(rows), "d1", "2026-09-02")).toBe("MONTHLY");
    expect(shiftLeaseMode(indexShiftLeases([...rows].reverse()), "d1", "2026-09-02")).toBe("MONTHLY");
  });
  it("段分けと絞り込みは名簿を変更せず、区分内の元の順序を保つ", () => {
    const drivers = [{ id: "d3" }, { id: "d2" }, { id: "d1" }, { id: "d4" }];
    const index = indexShiftLeases([lease(), lease({ driver_id: "d2", mode: "MONTHLY" }), lease({ driver_id: "d4" })]);
    expect(shiftLeaseGroups(drivers, index, "2026-08-31", "all", true).map(g => [g.mode, g.drivers.map(d => d.id)]))
      .toEqual([["MONTHLY", ["d2"]], ["DAILY", ["d1", "d4"]], ["NONE", ["d3"]]]);
    expect(shiftLeaseGroups(drivers, index, "2026-08-31", "DAILY", false)[0].drivers.map(d => d.id)).toEqual(["d1", "d4"]);
    expect(shiftLeaseGroups(drivers, index, "2026-08-31", "all", false)[0].drivers).toEqual(drivers);
    expect(drivers.map(d => d.id)).toEqual(["d3", "d2", "d1", "d4"]);
  });
  it("未取得・取得失敗ではリースなしに分類せず、フィルターで人を隠さない", () => {
    const drivers = [{ id: "d1" }];
    expect(shiftLeaseMode(indexShiftLeases(null), "d1", "2026-08-31")).toBeNull();
    expect(shiftLeaseMode(indexShiftLeases(undefined), "d1", "2026-08-31")).toBeNull();
    expect(shiftLeaseMode(indexShiftLeases([]), "d1", "2026-08-31")).toBe("NONE");
    expect(shiftLeaseGroups(drivers, null, "2026-08-31", "MONTHLY", true)).toEqual([{ mode: null, drivers }]);
    expect(shiftLeaseGroups(drivers, indexShiftLeases([]), "2026-08-31", "MONTHLY", true)).toEqual([]);
  });
});
