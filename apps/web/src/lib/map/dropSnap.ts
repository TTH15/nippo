// ============================================================
// 札をドラッグして離した位置を「どこに置いたか」に翻訳する（純粋ロジック）。
//
// 地図は座標だが、運営が言うのは「豊中センターの A-2」。離した点が拠点の範囲に
// 入っていれば拠点（さらに近ければ区画）へスナップして名前で確認できるようにし、
// どこにも入っていなければ座標のまま「登録外の場所」として扱う。
// 設計: docs/design/map-board-usability-2026-09.md §3 段階3
// ============================================================

export type SnapPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** point=1点 / circle=中心+半径 */
  shape?: "point" | "circle" | "polygon";
  radius_m?: number | null;
};

export type SnapSlot = {
  id: string;
  place_id: string;
  label: string;
  lat: number;
  lng: number;
};

export type DropTarget =
  | {
      kind: "place";
      placeId: string;
      placeName: string;
      slotId: string | null;
      slotLabel: string | null;
      /** 確認シートに出す文言（「豊中センター（A-2）」） */
      label: string;
    }
  | { kind: "outside"; placeId: null; placeName: null; slotId: null; slotLabel: null; label: string };

/** 点の拠点の既定半径（m）。敷地の広さを考えて少し広めに取る（駐車申告と同じ値） */
export const DEFAULT_PLACE_RADIUS_M = 120;
/** 区画に入ったと見なす距離（m）。1台分の枠は 2.5×5m 程度なので、少し余裕を持たせる */
export const SLOT_RADIUS_M = 15;

/** 2点間の概算距離（m）。数百m の判定にしか使わないので簡易式で十分 */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** その拠点に「入った」と見なす半径。円で登録されていればその半径、無ければ既定 */
export function placeRadiusM(place: SnapPlace): number {
  const r = place.shape === "circle" ? place.radius_m ?? 0 : 0;
  return r > 0 ? r : DEFAULT_PLACE_RADIUS_M;
}

export function snapDrop(
  lat: number,
  lng: number,
  places: readonly SnapPlace[],
  slots: readonly SnapSlot[] = [],
): DropTarget {
  let best: { place: SnapPlace; distance: number } | null = null;
  for (const place of places) {
    const distance = distanceM(lat, lng, place.lat, place.lng);
    if (distance > placeRadiusM(place)) continue;
    if (!best || distance < best.distance) best = { place, distance };
  }
  if (!best) {
    return { kind: "outside", placeId: null, placeName: null, slotId: null, slotLabel: null, label: "登録外の場所" };
  }

  let bestSlot: { slot: SnapSlot; distance: number } | null = null;
  for (const slot of slots) {
    if (slot.place_id !== best.place.id) continue;
    const distance = distanceM(lat, lng, slot.lat, slot.lng);
    if (distance > SLOT_RADIUS_M) continue;
    if (!bestSlot || distance < bestSlot.distance) bestSlot = { slot, distance };
  }

  return {
    kind: "place",
    placeId: best.place.id,
    placeName: best.place.name,
    slotId: bestSlot?.slot.id ?? null,
    slotLabel: bestSlot?.slot.label ?? null,
    label: bestSlot ? `${best.place.name}（${bestSlot.slot.label}）` : best.place.name,
  };
}
