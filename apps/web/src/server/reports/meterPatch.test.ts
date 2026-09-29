import { expect, it } from "vitest";
import { reportMeterPatch } from "./meterPatch";

it("写真解析と日報再送の順序に依存せず、メーター未指定は確定値を上書きしない", () => {
  expect({ meter_value: 123456, ...reportMeterPatch({}) }).toEqual({ meter_value: 123456 });
  expect(reportMeterPatch({})).not.toHaveProperty("meter_value");
});
it("旧Webの数値更新と明示nullの互換性を保つ", () => {
  expect(reportMeterPatch({ meterValue: 123500 })).toEqual({ meter_value: 123500 });
  expect(reportMeterPatch({ meterValue: 0 })).toEqual({ meter_value: 0 });
  expect(reportMeterPatch({ meterValue: null })).toEqual({ meter_value: null });
});
it("車両の訂正時は変更前の車両のメーターを引き継がない", () => {
  expect(reportMeterPatch({ vehicleId: "same" }, "same")).toEqual({});
  expect(reportMeterPatch({ vehicleId: "new" }, "old")).toEqual({ meter_value: null });
  expect(reportMeterPatch({ vehicleId: null }, "old")).toEqual({ meter_value: null });
});
