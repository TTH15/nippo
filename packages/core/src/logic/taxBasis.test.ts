import { describe, it, expect } from "vitest";
import {
  exclusiveContractTotal,
  exclusiveOf,
  exclusiveUnitPriceOf,
  inclusiveOf,
  inclusiveUnitPriceOf,
  roundUnitPrice,
} from "./taxBasis";

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

  it("単価は小数第2位まで保持して税換算する（金額と違い切り捨てない）", () => {
    expect(exclusiveUnitPriceOf(173.25, "inclusive")).toBe(157.5);
    expect(inclusiveUnitPriceOf(157.5, "exclusive")).toBe(173.25);
    expect(exclusiveUnitPriceOf(157.5, "exclusive")).toBe(157.5);
    expect(inclusiveUnitPriceOf(173.25, "inclusive")).toBe(173.25);
  });

  it("小数単価でも行合計は円単位の整数へ揃える", () => {
    expect(exclusiveContractTotal(157.5, 100, "exclusive")).toBe(15_750);
    expect(exclusiveContractTotal(157.5, 3, "exclusive")).toBe(473); // 472.5 → 473
    expect(exclusiveContractTotal(173.25, 100, "inclusive")).toBe(15_750);
  });

  it("roundUnitPrice は 0.01円 単位へ丸める", () => {
    expect(roundUnitPrice(157.499)).toBe(157.5);
    expect(roundUnitPrice(157.5 - 136.25)).toBe(21.25);
    expect(roundUnitPrice(Number.NaN)).toBe(0);
  });
});
