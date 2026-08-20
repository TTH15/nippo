import { describe, expect, it } from "vitest";
import { applyQuantityRule, normalizeQuantityRule } from "./quantityRule";

describe("quantityRule", () => {
  it("実数ルールは入力数量を維持する", () => {
    expect(applyQuantityRule(82, { kind: "actual" })).toBe(82);
  });

  it("最低保証数量に満たない日報は最低数量で計算する", () => {
    expect(applyQuantityRule(82, { kind: "minimum", minimum: 100, scope: "report" })).toBe(100);
    expect(applyQuantityRule(120, { kind: "minimum", minimum: 100, scope: "report" })).toBe(120);
  });

  it("不正なルールは実数へフォールバックする", () => {
    expect(normalizeQuantityRule({ kind: "minimum", minimum: -1 })).toEqual({ kind: "actual" });
  });
});
