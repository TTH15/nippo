// ============================================================
// 地図上の車両の見かけサイズ（純粋ロジック）。本番 /admin/map と検討用プレビューで共用する。
// 車両の長さを地図幅の約9%に保ち、寄って実寸に達したら等倍で止める（2026-09-02 プレビューで確定）。
// ============================================================

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAPBOX_TILE_SIZE = 512;

/**
 * 目標の車両長は「地図の短い辺（幅と高さの小さい方）」に対する比率で決める。
 * 幅だけを基準にすると、横長のPC画面（例: 2000×700）で車が地図の高さの1/4を占めて大きすぎた（2026-09-07）。
 * 短い辺なら、スマホ縦持ち・通常のPC・ワイドのどれでも画面に対して同じ見え方になる。
 * さらに絶対値の上限・下限で、巨大モニターと極小画面を抑える。
 */
export const VEHICLE_TARGET_SHORT_SIDE_RATIO = 0.14;
export const VEHICLE_TARGET_MIN_PIXELS = 40;
export const VEHICLE_TARGET_MAX_PIXELS = 120;
/**
 * 3D（ピッチあり）では手前の車がカメラに近く、中心で計った長さより大きく見える。
 * 手前の車が目標を超えないよう、ピッチが深いほど目標を下げる（ピッチ60°で約0.74倍）。
 */
export const VEHICLE_PITCH_SHRINK = 0.3;
/** 既定の車両長（アクティHH5）。車種別モデルは vehicleModels の登録表から渡す */
export const ACTY_HH5_LENGTH_METERS = 3.392;

export type VehicleMapPresentation = {
  modelScale: number;
  targetLengthPixels: number;
  renderedLengthPixels: number;
  /** 足元のコントラストリング半径（px） */
  contrastRadiusPixels: number;
  /** ナンバー札を車両の上へ逃がす量（px） */
  markerOffsetPixels: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 画面サイズとピッチから目標の車両長（px）を決める。ズームや緯度には依存しない */
export function targetVehicleLengthPixels({
  mapWidthPixels,
  mapHeightPixels = mapWidthPixels,
  pitch = 0,
}: {
  mapWidthPixels: number;
  mapHeightPixels?: number;
  pitch?: number;
}): number {
  const shortSide = Math.max(1, Math.min(mapWidthPixels, mapHeightPixels));
  const base = clamp(shortSide * VEHICLE_TARGET_SHORT_SIDE_RATIO, VEHICLE_TARGET_MIN_PIXELS, VEHICLE_TARGET_MAX_PIXELS);
  const safePitch = clamp(pitch, 0, 85);
  return base * (1 - VEHICLE_PITCH_SHRINK * Math.sin((safePitch * Math.PI) / 180));
}

export function vehicleMapPresentation({
  mapWidthPixels,
  mapHeightPixels,
  pitch,
  zoom,
  latitude,
  vehicleLengthMeters = ACTY_HH5_LENGTH_METERS,
}: {
  mapWidthPixels: number;
  mapHeightPixels?: number;
  pitch?: number;
  zoom: number;
  latitude: number;
  vehicleLengthMeters?: number;
}): VehicleMapPresentation {
  const length = Math.max(0.1, vehicleLengthMeters);
  const safeLatitude = Math.min(85, Math.max(-85, latitude));
  const metersPerPixel = (
    Math.cos((safeLatitude * Math.PI) / 180) * EARTH_CIRCUMFERENCE_METERS
  ) / (MAPBOX_TILE_SIZE * Math.pow(2, zoom));
  const targetLengthPixels = targetVehicleLengthPixels({ mapWidthPixels, mapHeightPixels, pitch });
  const actualLengthPixels = length / metersPerPixel;
  const modelScale = Math.max(1, targetLengthPixels / actualLengthPixels);
  const renderedLengthPixels = actualLengthPixels * modelScale;

  return {
    modelScale,
    targetLengthPixels,
    renderedLengthPixels,
    contrastRadiusPixels: Math.max(10, renderedLengthPixels * 0.46),
    markerOffsetPixels: Math.max(28, renderedLengthPixels * 0.62),
  };
}

/** 前回値からの差が描画に影響するときだけ true（毎フレームの setPaintProperty を避ける） */
export function presentationChanged(
  previous: VehicleMapPresentation | null,
  next: VehicleMapPresentation,
): { scale: boolean; contrast: boolean; offset: boolean } {
  if (!previous) return { scale: true, contrast: true, offset: true };
  return {
    scale: Math.abs(next.modelScale - previous.modelScale) > Math.max(0.002, next.modelScale * 0.001),
    contrast: Math.abs(next.contrastRadiusPixels - previous.contrastRadiusPixels) >= 0.1,
    offset: Math.abs(next.markerOffsetPixels - previous.markerOffsetPixels) >= 0.25,
  };
}
