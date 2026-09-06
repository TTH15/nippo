import { describe, expect, it } from "vitest";
import { presentationChanged, vehicleMapPresentation } from "./vehiclePresentation";
import { DEFAULT_VEHICLE_MAP_MODEL_KEY, VEHICLE_MAP_MODELS, mapModelKeyForVehicle, vehicleMapModelFor } from "@/lib/vehicleModels";

describe("presentationChanged", () => {
  it("初回はすべて更新対象", () => {
    const next = vehicleMapPresentation({ mapWidthPixels: 800, zoom: 12, latitude: 34.8 });
    expect(presentationChanged(null, next)).toEqual({ scale: true, contrast: true, offset: true });
  });
  it("差が閾値未満なら更新しない", () => {
    const a = vehicleMapPresentation({ mapWidthPixels: 800, zoom: 12, latitude: 34.8 });
    const b = vehicleMapPresentation({ mapWidthPixels: 800, zoom: 12.0001, latitude: 34.8 });
    expect(presentationChanged(a, b)).toEqual({ scale: false, contrast: false, offset: false });
    const c = vehicleMapPresentation({ mapWidthPixels: 800, zoom: 13, latitude: 34.8 });
    expect(presentationChanged(a, c).scale).toBe(true);
  });
});

describe("vehicleMapModelFor", () => {
  it("登録済みの車種はそのモデル、OEMは元車種、未設定・未登録は既定へ倒す", () => {
    expect(vehicleMapModelFor("acty")).toBe(VEHICLE_MAP_MODELS.acty);
    expect(vehicleMapModelFor("hijet")).toBe(VEHICLE_MAP_MODELS.hijet);
    expect(vehicleMapModelFor("clipper")).toBe(VEHICLE_MAP_MODELS.every);
    expect(vehicleMapModelFor("sambar")).toBe(VEHICLE_MAP_MODELS.hijet);
    expect(vehicleMapModelFor(null)).toBe(VEHICLE_MAP_MODELS[DEFAULT_VEHICLE_MAP_MODEL_KEY]);
    expect(vehicleMapModelFor("unknown-model")).toBe(VEHICLE_MAP_MODELS[DEFAULT_VEHICLE_MAP_MODEL_KEY]);
  });
  it("model_key が無い車もメーカー＋車種名から車種キーを引く（型式は問わない）", () => {
    expect(mapModelKeyForVehicle({ model_key: "acty", manufacturer: "スズキ", brand: "エブリイ" })).toBe("acty");
    expect(mapModelKeyForVehicle({ model_key: null, manufacturer: "ダイハツ", brand: "ハイゼットカーゴ" })).toBe("hijet");
    expect(mapModelKeyForVehicle({ model_key: null, manufacturer: "ダイハツ", brand: "ハイゼット" })).toBe("hijet");
    expect(mapModelKeyForVehicle({ model_key: null, manufacturer: "スズキ", brand: "エブリイ" })).toBe("every");
    expect(mapModelKeyForVehicle({ model_key: null, manufacturer: null, brand: null })).toBeNull();
  });
  it("全モデルが車体・固定色・灯火の3ファイルと全長を持つ", () => {
    for (const model of Object.values(VEHICLE_MAP_MODELS)) {
      expect(model.tintedUrl).toMatch(/-tinted\.glb$/);
      expect(model.fixedUrl).toMatch(/-fixed\.glb$/);
      expect(model.lampsUrl).toMatch(/-lamps\.glb$/);
      expect(model.lengthMeters).toBeGreaterThan(3);
    }
  });
});
