import { describe, expect, it } from "vitest";
import { hasParkingInspectionPhotos } from "./inspectionPolicy";

describe("駐車前の点検写真", () => {
  it("前・右・後・左が保存済みなら通す", () => {
    expect(hasParkingInspectionPhotos(["front", "right", "rear", "left"].map(angle => ({ angle, photo_path: `${angle}.jpg` })))).toBe(true);
  });

  it("メーター写真、同じ角度の重複、空のパスでは不足を埋められない", () => {
    expect(hasParkingInspectionPhotos(["front", "front", "rear", "left"].map(angle => ({ angle, photo_path: `${angle}.jpg` })))).toBe(false);
    expect(hasParkingInspectionPhotos(["front", "right", "rear", "left"].map(angle => ({ angle, photo_path: angle === "right" ? null : `${angle}.jpg` })))).toBe(false);
  });
});
