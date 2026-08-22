import { describe, it, expect } from "vitest";
import { exclusiveContractTotal, exclusiveOf, inclusiveOf } from "./taxBasis";

describe("taxBasis", () => {
  it("exclusive基準はそのまま（税込側は四捨五入で導出）", () => {
    expect(exclusiveOf(180, "exclusive")).toBe(180);
    expect(inclusiveOf(180, "exclusive")).toBe(198);
  });

  it("inclusive基準は切り捨てで税抜化（税込側はそのまま）", () => {
    expect(exclusiveOf(160, "inclusive")).toBe(145); // floor(160/1.1)=145.45→145
    expect(exclusiveOf(10000, "inclusive")).toBe(9090); // floor(10000/1.1)=9090.9→9090
    expect(inclusiveOf(160, "inclusive")).toBe(160);
  });

  it("税込契約は単価を丸めず、数量を掛けた行合計から税抜化する", () => {
    expect(exclusiveContractTotal(150, 100, "inclusive")).toBe(13_636);
    expect(exclusiveContractTotal(150, 100, "inclusive")).not.toBe(exclusiveOf(150, "inclusive") * 100);
    expect(exclusiveContractTotal(160, 80, "exclusive")).toBe(12_800);
  });
});
