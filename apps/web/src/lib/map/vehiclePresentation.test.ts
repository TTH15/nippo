import { describe, expect, it } from "vitest";
import { presentationChanged, vehicleMapPresentation } from "./vehiclePresentation";
import { DEFAULT_VEHICLE_MAP_MODEL_KEY, VEHICLE_MAP_MODELS, vehicleMapModelFor } from "@/lib/vehicleModels";

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
  it("登録済みの車種はその2層モデル、未設定・未登録は既定へ倒す", () => {
    expect(vehicleMapModelFor("acty")).toBe(VEHICLE_MAP_MODELS.acty);
    expect(vehicleMapModelFor(null)).toBe(VEHICLE_MAP_MODELS[DEFAULT_VEHICLE_MAP_MODEL_KEY]);
    expect(vehicleMapModelFor("unknown-model")).toBe(VEHICLE_MAP_MODELS[DEFAULT_VEHICLE_MAP_MODEL_KEY]);
  });
  it("全モデルが車体・固定色の2ファイルと全長を持つ", () => {
    for (const model of Object.values(VEHICLE_MAP_MODELS)) {
      expect(model.tintedUrl).toMatch(/-tinted\.glb$/);
      expect(model.fixedUrl).toMatch(/-fixed\.glb$/);
      expect(model.lengthMeters).toBeGreaterThan(3);
    }
  });
});
