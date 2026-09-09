import { describe, expect, it } from "vitest";
import { SPREAD_SPACING_M, spreadOverlapping, type SpreadInput } from "./spreadVehicles";

const at = (id: string, lat: number, lng: number, bearingDeg = 0): SpreadInput => ({ id, lat, lng, bearingDeg });

/** 2点間の概算距離（m） */
const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
};

describe("spreadOverlapping", () => {
  it("離れている車はそのままの座標", () => {
    const items = [at("a", 34.8, 135.47), at("b", 34.81, 135.48)];
    const out = spreadOverlapping(items);
    expect(out.get("a")).toEqual({ lat: 34.8, lng: 135.47 });
    expect(out.get("b")).toEqual({ lat: 34.81, lng: 135.48 });
  });

  it("完全に同じ座標の3台を等間隔で横に並べる", () => {
    const items = [at("a", 34.8, 135.47), at("b", 34.8, 135.47), at("c", 34.8, 135.47)];
    const out = spreadOverlapping(items);
    const [a, b, c] = ["a", "b", "c"].map((id) => out.get(id)!);
    expect(distanceM(a, b)).toBeCloseTo(SPREAD_SPACING_M, 1);
    expect(distanceM(b, c)).toBeCloseTo(SPREAD_SPACING_M, 1);
    // 中央（b）は元の座標に残る
    expect(distanceM(b, { lat: 34.8, lng: 135.47 })).toBeLessThan(0.01);
  });

  it("向きが 0 度なら東西に並ぶ（車の向きに直角）", () => {
    const out = spreadOverlapping([at("a", 34.8, 135.47, 0), at("b", 34.8, 135.47, 0)]);
    const a = out.get("a")!;
    const b = out.get("b")!;
    expect(Math.abs(a.lat - b.lat)).toBeLessThan(1e-9); // 緯度は変わらない
    expect(Math.abs(a.lng - b.lng)).toBeGreaterThan(0);
  });

  it("向きが 90 度なら南北に並ぶ", () => {
    const out = spreadOverlapping([at("a", 34.8, 135.47, 90), at("b", 34.8, 135.47, 90)]);
    const a = out.get("a")!;
    const b = out.get("b")!;
    expect(Math.abs(a.lng - b.lng)).toBeLessThan(1e-9);
    expect(Math.abs(a.lat - b.lat)).toBeGreaterThan(0);
  });

  it("並びは id 順で安定する（再描画で入れ替わらない）", () => {
    const first = spreadOverlapping([at("b", 34.8, 135.47), at("a", 34.8, 135.47)]);
    const second = spreadOverlapping([at("a", 34.8, 135.47), at("b", 34.8, 135.47)]);
    expect(first.get("a")).toEqual(second.get("a"));
    expect(first.get("b")).toEqual(second.get("b"));
  });

  it("しきい値より離れていれば別扱い", () => {
    // 10m 離れている（既定のしきい値 3m より大きい）
    const items = [at("a", 34.8, 135.47), at("b", 34.8 + 10 / 111_320, 135.47)];
    const out = spreadOverlapping(items);
    expect(out.get("a")).toEqual({ lat: 34.8, lng: 135.47 });
    expect(distanceM(out.get("b")!, items[1])).toBeLessThan(0.01);
  });

  it("台数が増えても中心は動かない", () => {
    const items = ["a", "b", "c", "d"].map((id) => at(id, 34.8, 135.47));
    const out = spreadOverlapping(items);
    const points = items.map((i) => out.get(i.id)!);
    const meanLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    expect(meanLng).toBeCloseTo(135.47, 8);
  });
});
