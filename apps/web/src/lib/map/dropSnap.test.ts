import { describe, expect, it } from "vitest";
import { DEFAULT_PLACE_RADIUS_M, placeRadiusM, snapDrop, type SnapPlace, type SnapSlot } from "./dropSnap";

// 緯度 34.8 付近。100m ≒ 0.0009 度（緯度方向）
const m = (meters: number) => meters / 111_320;

const toyonaka: SnapPlace = { id: "p1", name: "豊中センター", lat: 34.8, lng: 135.47, shape: "point" };
const kamitoba: SnapPlace = { id: "p2", name: "上鳥羽営業所", lat: 34.95, lng: 135.75, shape: "circle", radius_m: 300 };
const places = [toyonaka, kamitoba];
const slots: SnapSlot[] = [
  { id: "s1", place_id: "p1", label: "A-1", lat: 34.8, lng: 135.47 },
  { id: "s2", place_id: "p1", label: "A-2", lat: 34.8 + m(30), lng: 135.47 },
  { id: "s3", place_id: "p2", label: "B-1", lat: 34.95, lng: 135.75 },
];

describe("placeRadiusM", () => {
  it("円で登録された拠点はその半径、それ以外は既定", () => {
    expect(placeRadiusM(kamitoba)).toBe(300);
    expect(placeRadiusM(toyonaka)).toBe(DEFAULT_PLACE_RADIUS_M);
    expect(placeRadiusM({ ...kamitoba, radius_m: 0 })).toBe(DEFAULT_PLACE_RADIUS_M);
  });
});

describe("snapDrop", () => {
  it("拠点の範囲外なら登録外の場所", () => {
    const t = snapDrop(34.7, 135.3, places, slots);
    expect(t.kind).toBe("outside");
    expect(t.label).toBe("登録外の場所");
    expect(t.placeId).toBeNull();
  });

  it("既定半径の内側なら拠点にスナップする", () => {
    const t = snapDrop(34.8 + m(100), 135.47, places, slots);
    expect(t.kind).toBe("place");
    expect(t.placeName).toBe("豊中センター");
  });

  it("円で登録した拠点は登録した半径まで拾う", () => {
    // 既定の 120m は超えるが、登録半径 300m の内側
    const t = snapDrop(34.95 + m(200), 135.75, places, slots);
    expect(t.placeName).toBe("上鳥羽営業所");
  });

  it("区画に近ければ区画まで特定して名前に出す", () => {
    const t = snapDrop(34.8 + m(28), 135.47, places, slots);
    expect(t.slotLabel).toBe("A-2");
    expect(t.label).toBe("豊中センター（A-2）");
  });

  it("拠点の中でも区画から離れていれば拠点だけ", () => {
    const t = snapDrop(34.8 + m(80), 135.47, places, slots);
    expect(t.placeName).toBe("豊中センター");
    expect(t.slotId).toBeNull();
    expect(t.label).toBe("豊中センター");
  });

  it("他の拠点の区画は拾わない", () => {
    const t = snapDrop(34.8, 135.47, places, [slots[2]]);
    expect(t.placeName).toBe("豊中センター");
    expect(t.slotId).toBeNull();
  });

  it("重なっていたら近い方の拠点を選ぶ", () => {
    const near: SnapPlace = { id: "p3", name: "すぐ隣", lat: 34.8 + m(10), lng: 135.47 };
    const t = snapDrop(34.8 + m(12), 135.47, [toyonaka, near], []);
    expect(t.placeName).toBe("すぐ隣");
  });
});
