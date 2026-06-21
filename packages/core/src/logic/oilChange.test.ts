import { describe, it, expect } from "vitest";
import { computeOilStatus, isOilAlertVehicle, countOilAlertVehicles } from "./oilChange";

// 交換間隔3000km・前回0kmを基準に、現在走行距離でレベルが切り替わることを固定する。
const baseVehicle = {
  current_mileage: 0,
  last_oil_change_mileage: 0,
  oil_change_interval: 3000,
  is_ev: false,
  is_disposed: false,
};

describe("computeOilStatus", () => {
  it("間隔未設定/0 は判定対象外（null）", () => {
    expect(computeOilStatus({ ...baseVehicle, oil_change_interval: 0 })).toBeNull();
    expect(computeOilStatus({ ...baseVehicle, oil_change_interval: null })).toBeNull();
  });

  it("EV は判定対象外（null）", () => {
    expect(computeOilStatus({ ...baseVehicle, is_ev: true })).toBeNull();
  });

  it("余裕があれば safe", () => {
    const s = computeOilStatus({ ...baseVehicle, current_mileage: 2000 });
    expect(s?.level).toBe("safe");
    expect(s?.remaining).toBe(1000);
  });

  it("残り300km以下で warn", () => {
    expect(computeOilStatus({ ...baseVehicle, current_mileage: 2700 })?.level).toBe("warn");
    expect(computeOilStatus({ ...baseVehicle, current_mileage: 2701 })?.level).toBe("warn");
  });

  it("残り100km未満で critical", () => {
    expect(computeOilStatus({ ...baseVehicle, current_mileage: 2901 })?.level).toBe("critical");
  });

  it("超過（remaining マイナス）も critical", () => {
    const s = computeOilStatus({ ...baseVehicle, current_mileage: 3200 });
    expect(s?.level).toBe("critical");
    expect(s?.remaining).toBe(-200);
  });

  it("入力中メーターを先読みして判定（登録値より優先）", () => {
    const s = computeOilStatus({ ...baseVehicle, current_mileage: 1000 }, "2950");
    expect(s?.currentKm).toBe(2950);
    expect(s?.level).toBe("critical");
  });

  it("メーター空文字なら登録メーターを使う", () => {
    const s = computeOilStatus({ ...baseVehicle, current_mileage: 2800 }, "");
    expect(s?.currentKm).toBe(2800);
    expect(s?.level).toBe("warn");
  });
});

describe("isOilAlertVehicle / countOilAlertVehicles", () => {
  it("廃車は対象外", () => {
    expect(isOilAlertVehicle({ ...baseVehicle, current_mileage: 3200, is_disposed: true })).toBe(false);
  });

  it("safe は対象外、warn/critical は対象", () => {
    expect(isOilAlertVehicle({ ...baseVehicle, current_mileage: 1000 })).toBe(false);
    expect(isOilAlertVehicle({ ...baseVehicle, current_mileage: 2800 })).toBe(true);
    expect(isOilAlertVehicle({ ...baseVehicle, current_mileage: 3200 })).toBe(true);
  });

  it("警告対象の台数を数える", () => {
    const list = [
      { ...baseVehicle, current_mileage: 1000 }, // safe
      { ...baseVehicle, current_mileage: 2800 }, // warn
      { ...baseVehicle, current_mileage: 3200 }, // critical
      { ...baseVehicle, current_mileage: 3200, is_disposed: true }, // 廃車→除外
      { ...baseVehicle, current_mileage: 3200, is_ev: true }, // EV→除外
    ];
    expect(countOilAlertVehicles(list)).toBe(2);
  });
});
