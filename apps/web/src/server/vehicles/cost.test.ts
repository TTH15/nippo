import { describe, it, expect } from "vitest";
import { stripVehicleCost, stripVehicleCostAll, VEHICLE_COST_FIELDS } from "./cost";
import { filterActiveVehicleDrivers } from "./activeDrivers";

// 金額情報は can_view_vehicle_cost 保持者だけに返す。
// UI で隠すだけでは API 直叩きで見えるため、サーバーで落とすことを固定する。
describe("stripVehicleCost", () => {
  const vehicle = {
    id: "v1",
    manufacturer: "ダイハツ",
    brand: "アトレー",
    purchase_cost: 166420,
    purchase_cost_items: [{ sign: "+", label: "車両本体", amount: 150000 }],
    lease_cost: 35000,
    monthly_insurance: 5000,
    recovery_start_month: "2026-01-01",
    recovery_carryover: 1000,
    recovery_collected: { 1: "2026-01-31" },
    recovered_amount: 42786,
    remaining_amount: 123634,
  };

  it("権限が無ければ金額列を全て落とす", () => {
    const masked = stripVehicleCost(vehicle, false);
    for (const field of VEHICLE_COST_FIELDS) {
      expect(masked, `${field} が残っている`).not.toHaveProperty(field);
    }
  });

  it("権限が無くても金額以外は残る（車両として使えなくならない）", () => {
    const masked = stripVehicleCost(vehicle, false);
    expect(masked.id).toBe("v1");
    expect(masked.manufacturer).toBe("ダイハツ");
    expect(masked.brand).toBe("アトレー");
  });

  it("権限があれば素通し", () => {
    expect(stripVehicleCost(vehicle, true)).toEqual(vehicle);
  });

  it("元のオブジェクトを壊さない", () => {
    stripVehicleCost(vehicle, false);
    expect(vehicle.purchase_cost).toBe(166420);
  });

  it("配列版も同様に落とす", () => {
    const masked = stripVehicleCostAll([vehicle, { ...vehicle, id: "v2" }], false);
    expect(masked).toHaveLength(2);
    for (const v of masked) {
      expect(v).not.toHaveProperty("purchase_cost");
      expect(v).not.toHaveProperty("recovered_amount");
    }
  });
});

// vehicle_drivers には退職後の紐付けが残る。一覧にだけ退職者が出て
// 編集モーダル（稼働中のみが候補）と食い違う不具合を防ぐ。
describe("filterActiveVehicleDrivers", () => {
  const active = { driver_id: "d1", drivers: { works_as_driver: true, status: "active" } };
  const retired = { driver_id: "d2", drivers: { works_as_driver: true, status: "inactive" } };
  const notDriver = { driver_id: "d3", drivers: { works_as_driver: false, status: "active" } };

  it("稼働中だけを残す", () => {
    expect(filterActiveVehicleDrivers([active, retired, notDriver])).toEqual([active]);
  });

  it("稼働終了（inactive）を除外する", () => {
    expect(filterActiveVehicleDrivers([retired])).toEqual([]);
  });

  it("ドライバー稼働していないメンバーを除外する", () => {
    expect(filterActiveVehicleDrivers([notDriver])).toEqual([]);
  });

  it("drivers が取れない行は除外（default-deny）", () => {
    expect(filterActiveVehicleDrivers([{ driver_id: "d4" }])).toEqual([]);
    expect(filterActiveVehicleDrivers([{ driver_id: "d5", drivers: null }])).toEqual([]);
  });

  it("null / undefined でも落ちない", () => {
    expect(filterActiveVehicleDrivers(null)).toEqual([]);
    expect(filterActiveVehicleDrivers(undefined)).toEqual([]);
  });
});
