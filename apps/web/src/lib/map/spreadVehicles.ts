// ============================================================
// 同じ地点に重なった車を、表示のうえで横へ並べる（純粋ロジック）。
//
// 拠点で降ろした車は「拠点の代表点」がそのまま記録されることが多く、
// 3〜4台が完全に同じ座標で重なる。寄っても1台にしか見えず、台数を誤認する。
// 記録は動かさず、描画位置だけを 1.2 台分ずつ横へずらす（監査 K-11）。
//
// ずらす向きは車の向き（区画の軸）に対して直角。実際の駐車場と同じく
// 「横に並ぶ」形になり、前後にずらすより自然に見える。
// 設計: docs/design/map-board-usability-2026-09.md §3 段階4
// ============================================================

/** これ以下しか離れていない車は「同じ場所」と見なす（m） */
export const OVERLAP_THRESHOLD_M = 3;
/** 並べる間隔（m）。軽自動車の全長 3.4m の約 1.2 台分 */
export const SPREAD_SPACING_M = 4.1;

export type SpreadInput = {
  id: string;
  lat: number;
  lng: number;
  /** 車の向き（度）。ずらす向きはこれに直角 */
  bearingDeg?: number;
};

export type SpreadPoint = { lat: number; lng: number };

const distanceM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
};

/**
 * 重なっている車の描画位置を返す。重なっていない車は元の座標のまま。
 * 並びは id 順に固定する（再描画のたびに入れ替わると目で追えなくなる）。
 */
export function spreadOverlapping(
  items: readonly SpreadInput[],
  options: { thresholdM?: number; spacingM?: number } = {},
): Map<string, SpreadPoint> {
  const threshold = options.thresholdM ?? OVERLAP_THRESHOLD_M;
  const spacing = options.spacingM ?? SPREAD_SPACING_M;
  const result = new Map<string, SpreadPoint>();

  const groups: SpreadInput[][] = [];
  for (const item of items) {
    const group = groups.find((g) => distanceM(g[0].lat, g[0].lng, item.lat, item.lng) <= threshold);
    if (group) group.push(item);
    else groups.push([item]);
  }

  for (const group of groups) {
    if (group.length === 1) {
      result.set(group[0].id, { lat: group[0].lat, lng: group[0].lng });
      continue;
    }
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id));
    // 代表点（先頭の車の座標）を中心に、左右へ均等に散らす
    const center = ordered[0];
    const bearing = ((center.bearingDeg ?? 0) + 90) * (Math.PI / 180);
    const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1;
    ordered.forEach((item, index) => {
      const offset = (index - (ordered.length - 1) / 2) * spacing;
      const north = offset * Math.cos(bearing);
      const east = offset * Math.sin(bearing);
      result.set(item.id, {
        lat: center.lat + north / 111_320,
        lng: center.lng + east / (111_320 * cosLat),
      });
    });
  }

  return result;
}
