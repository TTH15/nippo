import { describe, expect, it } from "vitest";
import { DEFAULT_PLACE_RADIUS_M } from "@/lib/map/dropSnap";
import { MAX_SNAP_ACCURACY_M, snapParkingCoords } from "./parkingSnap";

// 緯度1度 ≈ 111,320m。東へ n m ずらした座標を作る
const east = (lng: number, meters: number) => lng + meters / (111_320 * Math.cos((34.78 * Math.PI) / 180));

const center = { lat: 34.78, lng: 135.47 };
const point = { id: "p1", name: "豊中センター", lat: center.lat, lng: center.lng };
const circle = { id: "p2", name: "吹田車庫", lat: 34.79, lng: 135.52, shape: "circle" as const, radius_m: 200 };

describe("snapParkingCoords", () => {
  it("誤差円が拠点に収まれば確定する", () => {
    const result = snapParkingCoords({ ...center, accuracyM: 12 }, [point]);
    expect(result).toMatchObject({ placeId: "p1", placeName: "豊中センター", reason: "snapped" });
  });

  it("円で登録された拠点はその半径で判定する", () => {
    // 中心から150m。点の既定半径(120m)では外だが、半径200mの円には収まる
    const at = { lat: circle.lat, lng: east(circle.lng, 150), accuracyM: 20 };
    expect(snapParkingCoords(at, [circle])).toMatchObject({ placeId: "p2", reason: "snapped" });
  });

  it("誤差円が境界をはみ出すと確定せず、候補だけ残す", () => {
    const at = { lat: center.lat, lng: east(center.lng, DEFAULT_PLACE_RADIUS_M - 10), accuracyM: 40 };
    const result = snapParkingCoords(at, [point]);
    expect(result.placeId).toBeNull();
    expect(result.reason).toBe("edge");
    expect(result.candidates.map((c) => c.id)).toEqual(["p1"]);
  });

  it("複数の拠点に触れたら確定しない（近い順に候補を返す）", () => {
    const near = { id: "p3", name: "隣の車庫", lat: center.lat, lng: east(center.lng, 60) };
    const result = snapParkingCoords({ ...center, accuracyM: 10 }, [point, near]);
    expect(result.placeId).toBeNull();
    expect(result.reason).toBe("ambiguous");
    expect(result.candidates.map((c) => c.id)).toEqual(["p1", "p3"]);
  });

  it("粗い測位は拠点に当てない（座標だけ保存する）", () => {
    const result = snapParkingCoords({ ...center, accuracyM: MAX_SNAP_ACCURACY_M + 1 }, [point]);
    expect(result).toMatchObject({ placeId: null, reason: "accuracy" });
  });

  it("精度不明は良い測位として扱わない", () => {
    expect(snapParkingCoords({ ...center, accuracyM: null }, [point])).toMatchObject({ placeId: null });
  });

  it("どこにも当たらなければ候補なし", () => {
    const far = { lat: 35.68, lng: 139.76, accuracyM: 10 };
    expect(snapParkingCoords(far, [point, circle])).toMatchObject({ placeId: null, reason: "no_candidate", candidates: [] });
  });

  it("区画は決めない（返すのは拠点まで）", () => {
    const result = snapParkingCoords({ ...center, accuracyM: 5 }, [point]);
    expect(Object.keys(result)).not.toContain("slotId");
  });

  it("座標が数値でなければ確定しない", () => {
    expect(snapParkingCoords({ lat: Number.NaN, lng: center.lng, accuracyM: 5 }, [point])).toMatchObject({ placeId: null });
  });
});
