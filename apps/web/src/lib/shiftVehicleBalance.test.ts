import { describe, expect, it } from "vitest";
import { computeVehicleBalance, duplicateVehicleIds, formatVehicleBalance } from "./shiftVehicleBalance";

const fleet = [
  { id: "v1" },
  { id: "v2", is_unavailable: true },
  { id: "v3", is_disposed: true },
  { id: "v4" },
  { id: "v5" },
];

describe("computeVehicleBalance", () => {
  it("廃車・一時使用不可・貸出中を除いた台数と、他社車両を除いた稼働人数で過不足を出す", () => {
    const balance = computeVehicleBalance({
      fleet,
      loanedIds: new Set(["v5"]),
      workingDriverIds: ["d1", "d2", "d3"],
      isExternal: (id) => id === "d3",
    });
    expect(balance).toEqual({ usable: 2, demand: 2, surplus: 0 });
  });
  it("同じ車を2人で回す日は1台として数え、未割当の人だけ1台ずつ必要とみなす", () => {
    const balance = computeVehicleBalance({
      fleet: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
      workingDriverIds: ["d1", "d2", "d3", "d4", "d5"],
      vehicleOf: (id) => ({ d1: "v1", d2: "v1", d3: "v2" } as Record<string, string>)[id] ?? null,
      isExternal: (id) => id === "d5",
    });
    // 割当済み v1・v2 の2台 ＋ 未割当の d4 の1台 = 3台必要 → ちょうど
    expect(balance).toEqual({ usable: 3, demand: 3, surplus: 0 });
  });
  it("不足は負の値", () => {
    expect(computeVehicleBalance({ fleet, workingDriverIds: ["d1", "d2", "d3", "d4"] }).surplus).toBe(-1);
    expect(computeVehicleBalance({ fleet, workingDriverIds: [] }).surplus).toBe(3);
  });
});

describe("formatVehicleBalance", () => {
  it("余り・不足・ちょうどを短く表す", () => {
    expect(formatVehicleBalance({ surplus: 2 })).toBe("車 余り2台");
    expect(formatVehicleBalance({ surplus: -1 })).toBe("車 不足1台");
    expect(formatVehicleBalance({ surplus: 0 })).toBe("車 ちょうど");
  });
});

describe("duplicateVehicleIds", () => {
  it("2人以上が同じ車両のときだけ検出し、同一人物の重複は数えない", () => {
    const holders = new Map([
      ["v1", ["d1", "d2"]],
      ["v2", ["d3"]],
      ["v3", ["d4", "d4"]],
    ]);
    expect([...duplicateVehicleIds(holders)]).toEqual(["v1"]);
  });
});
