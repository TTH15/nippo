import { describe, expect, it } from "vitest";
import {
  VEHICLE_TARGET_MIN_PIXELS,
  presentationChanged,
  targetVehicleLengthPixels,
  vehicleMapPresentation,
} from "./vehiclePresentation";
import { DEFAULT_VEHICLE_MAP_MODEL_KEY, VEHICLE_MAP_MODELS, mapModelKeyForVehicle, modelUrlFor, vehicleMapModelFor } from "@/lib/vehicleModels";

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
  it("車両編集の3Dプレビューも同じ車種のモデルを使い、OEM・未登録は地図と同じ規則で倒す", () => {
    expect(modelUrlFor("hijet")).toBe("/models/hijet-s300-blockout-19.glb");
    expect(modelUrlFor("sambar")).toBe("/models/hijet-s300-blockout-19.glb");
    expect(modelUrlFor("clipper")).toBe("/models/every-da64v-blockout-88.glb");
    expect(modelUrlFor(null)).toBe("/models/every-da64v-blockout-88.glb");
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

describe("ズーム下限（J-2: 広域では車体を出さない）", () => {
  const at = (zoom: number) =>
    vehicleMapPresentation({ mapWidthPixels: 1440, mapHeightPixels: 800, zoom, latitude: 34.8 });

  it("z13 未満はモデルもリングも出さない", () => {
    for (const zoom of [8, 10, 12, 12.99]) {
      const p = at(zoom);
      expect(p.modelVisible).toBe(false);
      expect(p.renderedLengthPixels).toBe(0);
      expect(p.contrastRadiusPixels).toBe(0);
    }
  });

  it("z13 でちょうど下限の 40px、z15 以上で目標いっぱい", () => {
    expect(at(13).modelVisible).toBe(true);
    expect(at(13).targetLengthPixels).toBeCloseTo(VEHICLE_TARGET_MIN_PIXELS, 5);
    const full = targetVehicleLengthPixels({ mapWidthPixels: 1440, mapHeightPixels: 800 });
    expect(at(15).targetLengthPixels).toBeCloseTo(full, 5);
    expect(at(18).targetLengthPixels).toBeCloseTo(full, 5);
  });

  it("z13〜15 は単調に大きくなる", () => {
    const sizes = [13, 13.5, 14, 14.5, 15].map((z) => at(z).targetLengthPixels);
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });

  it("表示・非表示の切り替わりは必ず反映する", () => {
    expect(presentationChanged(at(12.9), at(13)).scale).toBe(true);
    expect(presentationChanged(at(13), at(12.9)).contrast).toBe(true);
  });

  it("札の逃がし量は車体が無くても 0 にしない（ドットと重ならない）", () => {
    expect(at(10).markerOffsetPixels).toBeGreaterThan(0);
  });
});
