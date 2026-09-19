import { describe, it, expect } from "vitest";
import { colorForVehicleMaterial, isVehiclePartColors, orderedVehicleColors } from "./vehicleAppearance";
describe("車両の部位別塗装", () => {
  it("ボンネットの別色は全体色を変えても残り、解除した部位だけ追従する", () => {
    expect(colorForVehicleMaterial("Paint Hood", "#ffffff", { hood: "#000000" })).toBe("#000000");
    expect(colorForVehicleMaterial("Paint Hood", "#ff0000", { hood: "#000000" })).toBe("#000000");
    expect(colorForVehicleMaterial("Paint Hood", "#ff0000", {})).toBe("#ff0000");
    expect(colorForVehicleMaterial("Paint Rear Bumper", "#ffffff", { frontBumper: "#111111" })).toBe("#ffffff");
  });
  it("写真仕様の黒ボンネットは元色を保ち、個別設定なら変更できる。窓や灯火は塗らない", () => {
    expect(colorForVehicleMaterial("Fixed Paint Hood", "#ffffff")).toBeNull();
    expect(colorForVehicleMaterial("Fixed Paint Hood", "#ffffff", { hood: "#ff0000" })).toBe("#ff0000");
    for (const name of ["Glass", "Tire", "Headlight Lens", "Front Plate"]) expect(colorForVehicleMaterial(name, "#ff0000")).toBeNull();
  });
  it("指定外の部位・CSS・不正なJSONを拒否する", () => {
    for (const v of [null, [], "#ffffff", { roof: "#ffffff" }, { hood: "red" }, { hood: null }, { hood: "url(x)" }]) expect(isVehiclePartColors(v)).toBe(false);
    expect(isVehiclePartColors({})).toBe(true); expect(isVehiclePartColors({ hood: "#AABBCC" })).toBe(true);
  });
  it("保存順に依存せず、白系から黒系・有彩色の順。同じ色は重複しない", () => {
    const c = ["#ffffff", "#f1f5f9", "#c0c6cc", "#272b30", "#1f2937", "#ff0000", "#0000ff"].map(value => ({ value, label: value }));
    expect(orderedVehicleColors([...c].reverse())).toEqual(c);
    expect(orderedVehicleColors([...c, { value: "#FFFFFF", label: "白" }])).toEqual(c);
  });
});
