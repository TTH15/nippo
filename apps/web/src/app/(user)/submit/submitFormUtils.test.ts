import { describe, it, expect } from "vitest";
import { evaluateMeter } from "./submitFormUtils";

describe("evaluateMeter", () => {
  it("車両なしならメーター不要・送信可", () => {
    const s = evaluateMeter("", null);
    expect(s.required).toBe(false);
    expect(s.canSubmit).toBe(true);
  });

  it("EV車はメーター不要・送信可", () => {
    const s = evaluateMeter("", { is_ev: true, current_mileage: 1000 });
    expect(s.required).toBe(false);
    expect(s.canSubmit).toBe(true);
  });

  it("非EVでメーター未入力なら missing・送信不可", () => {
    const s = evaluateMeter("", { is_ev: false, current_mileage: 50000 });
    expect(s.required).toBe(true);
    expect(s.missing).toBe(true);
    expect(s.canSubmit).toBe(false);
  });

  it("登録値より小さい入力は belowPrev・送信不可", () => {
    const s = evaluateMeter("49000", { is_ev: false, current_mileage: 50000 });
    expect(s.belowPrev).toBe(true);
    expect(s.canSubmit).toBe(false);
  });

  it("登録値と同値は belowPrev・送信不可（単調増加が必要）", () => {
    const s = evaluateMeter("50000", { is_ev: false, current_mileage: 50000 });
    expect(s.belowPrev).toBe(true);
    expect(s.canSubmit).toBe(false);
  });

  it("登録値より大きい入力は送信可", () => {
    const s = evaluateMeter("50001", { is_ev: false, current_mileage: 50000 });
    expect(s.belowPrev).toBe(false);
    expect(s.missing).toBe(false);
    expect(s.canSubmit).toBe(true);
  });

  it("走行距離が未登録(0)の車両は初回入力として任意の正値で送信可", () => {
    const s = evaluateMeter("100", { is_ev: false, current_mileage: 0 });
    expect(s.belowPrev).toBe(false);
    expect(s.canSubmit).toBe(true);
  });

  it("current_mileage が null/undefined でも prevKm=0 として扱う", () => {
    expect(evaluateMeter("100", { is_ev: false, current_mileage: null }).canSubmit).toBe(true);
    expect(evaluateMeter("100", { is_ev: false }).canSubmit).toBe(true);
  });

  it("前後の空白は無視される", () => {
    expect(evaluateMeter("  ", { is_ev: false, current_mileage: 50000 }).missing).toBe(true);
    expect(evaluateMeter(" 50001 ", { is_ev: false, current_mileage: 50000 }).canSubmit).toBe(true);
  });
});
