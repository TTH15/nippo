import { describe, expect, it } from "vitest";
import {
  normalizeVehicleInteger,
  sortVehiclesByRegistration,
  validateVehicleForm,
} from "./vehicleAdmin";

describe("vehicleAdmin", () => {
  it("UUIDではなく登録日時の古い順に並べる", () => {
    const vehicles = [
      { id: "0000", created_at: "2026-09-01T09:00:00Z" },
      { id: "ffff", created_at: "2026-08-01T09:00:00Z" },
    ];

    expect(sortVehiclesByRegistration(vehicles).map((vehicle) => vehicle.id)).toEqual(["ffff", "0000"]);
  });

  it("車種が未選択なら基本タブの不足項目として返す", () => {
    expect(validateVehicleForm({ manufacturer: "", brand: "" })[0]).toEqual({
      field: "identity",
      tab: "basic",
      message: "車種を選択してください。その他の車両はメーカー名または車種名を入力してください。",
    });
  });

  it("任意のメーター欄は空欄を許可し、保存時は既定値へ揃える", () => {
    expect(validateVehicleForm({ manufacturer: "スズキ", currentMileage: "" })).toEqual([]);
    expect(normalizeVehicleInteger("", 0)).toBe(0);
    expect(normalizeVehicleInteger(null, 3000)).toBe(3000);
  });

  it("不正な数値は項目名つきで返す", () => {
    expect(validateVehicleForm({ manufacturer: "スズキ", currentMileage: "-1.5" })).toContainEqual({
      field: "currentMileage",
      tab: "work",
      message: "現在メーターは0以上の整数で入力してください。",
    });
  });
});
