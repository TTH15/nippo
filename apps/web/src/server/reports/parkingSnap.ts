// ============================================================
// 座標だけの駐車申告を「どの車庫か」に翻訳する（純粋ロジック）。
// 設計: docs/design/mobile-parking-auto-detect.md §2-3
//
// 端末は座標だけを送り、車庫マスタは端末に配らない。ここで決めるのは拠点までで、
// 区画（A-1 など）は決めない。数十mの水平精度では隣の区画と区別できないため、
// 区画は番号写真・区画QR・本人の指定でだけ確定させる。
//
// 運営が地図で札を離したときの snapDrop（lib/map/dropSnap.ts）とは別物。
// あちらは「本人がそこを指した」ので中心からの距離だけで決めてよいが、
// こちらは測位の誤差円があるので、誤差円が拠点に収まるときだけ確定する。
// ============================================================
import { distanceM, placeRadiusM, type SnapPlace } from "@/lib/map/dropSnap";

/** 端末から受け取った測位。accuracyM は水平精度（m） */
export type ParkingCoords = { lat: number; lng: number; accuracyM: number | null };

/** これより粗い測位は拠点に当てない（座標だけ保存する） */
export const MAX_SNAP_ACCURACY_M = 150;

export type ParkingSnapResult = {
  /** 確定した拠点。確定しなければ null（座標だけを保存する） */
  placeId: string | null;
  placeName: string | null;
  /** 誤差円に触れている拠点。確定しなかった理由を運営へ出すために返す */
  candidates: { id: string; name: string; distanceM: number }[];
  /** 確定しなかった理由。表示の出し分けに使う */
  reason: "snapped" | "no_candidate" | "ambiguous" | "accuracy" | "edge";
};

const NOT_SNAPPED = (
  reason: ParkingSnapResult["reason"],
  candidates: ParkingSnapResult["candidates"],
): ParkingSnapResult => ({ placeId: null, placeName: null, candidates, reason });

/**
 * 誤差円が1つの拠点にすっぽり収まるときだけ拠点を確定する。
 * 境界をまたぐ・複数に触れる・測位が粗いときは確定せず、座標と候補だけを残す。
 * places には allow_parking = true の自社拠点だけを渡すこと（呼び出し側で絞る）。
 */
export function snapParkingCoords(coords: ParkingCoords, places: readonly SnapPlace[]): ParkingSnapResult {
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return NOT_SNAPPED("no_candidate", []);
  // 精度不明は「良い測位」と見なさない。既定の点の半径を誤差として扱う
  const accuracy = coords.accuracyM == null || !Number.isFinite(coords.accuracyM)
    ? MAX_SNAP_ACCURACY_M
    : Math.max(0, coords.accuracyM);

  const touching = places
    .map((place) => ({ place, distance: distanceM(coords.lat, coords.lng, place.lat, place.lng) }))
    .filter(({ place, distance }) => distance <= placeRadiusM(place) + accuracy)
    .sort((a, b) => a.distance - b.distance);
  const candidates = touching.map(({ place, distance }) => ({
    id: place.id,
    name: place.name,
    distanceM: Math.round(distance),
  }));

  if (accuracy > MAX_SNAP_ACCURACY_M) return NOT_SNAPPED("accuracy", candidates);
  if (touching.length === 0) return NOT_SNAPPED("no_candidate", []);
  if (touching.length > 1) return NOT_SNAPPED("ambiguous", candidates);

  const [only] = touching;
  // 誤差円が拠点の境界をはみ出すなら、その場にいたとは言い切れない
  if (only.distance + accuracy > placeRadiusM(only.place)) return NOT_SNAPPED("edge", candidates);
  return { placeId: only.place.id, placeName: only.place.name, candidates, reason: "snapped" };
}
