import { describe, expect, it } from "vitest";
import { forecastOilChange, forecastOilChangesByVehicle, remainingOilKm } from "./oilForecast";

const courseKmPerDay = { "c-short": 50, "c-long": 160 };

describe("remainingOilKm", () => {
  it("前回交換 + 間隔 − 現在の走行距離", () => {
    expect(remainingOilKm({ current_mileage: 166741, last_oil_change_mileage: 165000, oil_change_interval: 3000 }))
      .toBe(1259);
  });
  it("超過していればマイナスで返す（既存の警告の領分）", () => {
    expect(remainingOilKm({ current_mileage: 168500, last_oil_change_mileage: 165000, oil_change_interval: 3000 }))
      .toBe(-500);
  });
  it("EV・設定なし・走行距離なしは null", () => {
    expect(remainingOilKm({ is_ev: true, current_mileage: 100, last_oil_change_mileage: 0, oil_change_interval: 3000 })).toBeNull();
    expect(remainingOilKm({ current_mileage: 100, oil_change_interval: 0 })).toBeNull();
    expect(remainingOilKm({ last_oil_change_mileage: 0, oil_change_interval: 3000 })).toBeNull();
  });
});

describe("forecastOilChange", () => {
  const shifts = [
    { date: "2026-09-11", courseId: "c-short" },
    { date: "2026-09-12", courseId: "c-short" },
    { date: "2026-09-13", courseId: "c-short" },
  ];

  it("残り距離に届いた最初の日を返す", () => {
    const f = forecastOilChange({ remainingKm: 120, shifts, courseKmPerDay, fallbackKmPerDay: 70 });
    expect(f).toEqual({ date: "2026-09-13", workDays: 3, km: 150 });
  });

  it("予定の範囲で届かなければ null（先へは伸ばさない）", () => {
    expect(forecastOilChange({ remainingKm: 1000, shifts, courseKmPerDay, fallbackKmPerDay: 70 })).toBeNull();
  });

  it("コースごとの距離を使う（長いコースなら早く届く）", () => {
    const long = shifts.map((s) => ({ ...s, courseId: "c-long" }));
    expect(forecastOilChange({ remainingKm: 300, shifts: long, courseKmPerDay, fallbackKmPerDay: 70 })?.date)
      .toBe("2026-09-12");
  });

  it("同じ日に2便入っていれば、その日ぶんを足す", () => {
    const twice = [
      { date: "2026-09-11", courseId: "c-short" },
      { date: "2026-09-11", courseId: "c-short" },
      { date: "2026-09-12", courseId: "c-short" },
    ];
    const f = forecastOilChange({ remainingKm: 90, shifts: twice, courseKmPerDay, fallbackKmPerDay: 70 });
    expect(f).toEqual({ date: "2026-09-11", workDays: 1, km: 100 });
  });

  it("コースの実績が無ければその車の実績を使う", () => {
    const unknown = shifts.map((s) => ({ ...s, courseId: "c-unknown" }));
    expect(forecastOilChange({ remainingKm: 150, shifts: unknown, courseKmPerDay, fallbackKmPerDay: 80 })?.date)
      .toBe("2026-09-12");
  });

  it("日付が前後して渡ってきても、日付順に積む", () => {
    const shuffled = [shifts[2], shifts[0], shifts[1]];
    expect(forecastOilChange({ remainingKm: 60, shifts: shuffled, courseKmPerDay, fallbackKmPerDay: 70 })?.date)
      .toBe("2026-09-12");
  });

  it("既に超過している車は予測を出さない（事実の警告に任せる）", () => {
    expect(forecastOilChange({ remainingKm: -100, shifts, courseKmPerDay, fallbackKmPerDay: 70 })).toBeNull();
    expect(forecastOilChange({ remainingKm: 0, shifts, courseKmPerDay, fallbackKmPerDay: 70 })).toBeNull();
  });

  it("予定が無ければ null", () => {
    expect(forecastOilChange({ remainingKm: 100, shifts: [], courseKmPerDay, fallbackKmPerDay: 70 })).toBeNull();
  });
});

describe("forecastOilChangesByVehicle", () => {
  const vehicles = [
    { id: "v1", current_mileage: 1900, last_oil_change_mileage: 0, oil_change_interval: 2000 }, // 残り100
    { id: "v2", current_mileage: 100, last_oil_change_mileage: 0, oil_change_interval: 3000 }, // 残り2900
    { id: "v3", is_ev: true, current_mileage: 100, last_oil_change_mileage: 0, oil_change_interval: 3000 },
  ];
  const shifts = [
    { date: "2026-09-11", courseId: "c-short", vehicleId: "v1" },
    { date: "2026-09-12", courseId: "c-short", vehicleId: "v1" },
    { date: "2026-09-11", courseId: "c-short", vehicleId: "v2" },
    { date: "2026-09-11", courseId: "c-short", vehicleId: null },
  ];

  it("届く車だけを返す。EV・遠い車・車両未定は出さない", () => {
    const out = forecastOilChangesByVehicle({
      vehicles, shifts, courseKmPerDay, vehicleKmPerDay: {}, fleetKmPerDay: 70,
    });
    expect([...out.keys()]).toEqual(["v1"]);
    expect(out.get("v1")?.date).toBe("2026-09-12");
  });
});
