import { describe, it, expect } from "vitest";
import { normalizeModelCode, resolveModelKey, mapModelKeyForVehicle, modelUrlFor, vehicleIdentityForCode, vehicleMapModelFor, modelChoicesFor } from "./vehicleModels";
describe("型式別モデル", () => {
  it("接頭辞・全角・ハイフンを照合用に正規化する", () => {
    expect(normalizeModelCode(" ＨＢＤ−ｄａ１７ｖ ")).toBe("DA17V");
    expect(resolveModelKey("スズキ", "エブリィ", "HBD-DA17V")).toBe("every-da17v");
    expect(resolveModelKey("スズキ", "エブリイ", "EBD-DA64V")).toBe("every-da64v");
  });
  it("メーカー・用途・未確認型式を混同しない", () => {
    expect(vehicleIdentityForCode("DA17V", "ホンダ")).toBeNull();
    expect(resolveModelKey("スズキ", "エブリイ", "DA17W")).toBeNull();
    expect(resolveModelKey("スズキ", "エブリイ", "DA17V改")).toBeNull();
    expect(resolveModelKey("スズキ", "エブリイ", "UNKNOWN-DA17V")).toBeNull();
    expect(resolveModelKey("ホンダ", "N-VAN", "JJ1")).toBeNull();
  });
  it("型式で旧汎用キーを更新し、確認して選んだ外観は維持する", () => {
    const v = { manufacturer: "スズキ", brand: "エブリイ", model_code: "DA17V" };
    expect(mapModelKeyForVehicle({ ...v, model_key: "every" })).toBe("every-da17v");
    expect(mapModelKeyForVehicle({ ...v, model_key: "every-da64v" })).toBe("every-da17v");
    expect(mapModelKeyForVehicle({ ...v, model_key: "appearance:every-photo-custom" })).toBe("every-photo-custom");
    expect(mapModelKeyForVehicle({ ...v, model_key: "appearance:clipper-dr17v" })).toBe("every-da17v");
  });
  it("OEMと旧世代が別GLBを使い、編集と地図の版が一致する", () => {
    const u = resolveModelKey("三菱", "ミニキャブ", "U61V");
    const d = resolveModelKey("三菱", "ミニキャブ", "DS17V");
    expect(u).not.toBe(d);
    for (const k of [u, d, "every-da17v", null]) expect(modelUrlFor(k)).toBe(`/models/${vehicleMapModelFor(k).id}.glb`);
  });
  it("型式未確定の写真仕様は手動候補にだけ出す", () => {
    expect(modelChoicesFor("スズキ", "エブリイ").find(v => v.key === "every-photo-custom")?.codes).toEqual([]);
  });
});
