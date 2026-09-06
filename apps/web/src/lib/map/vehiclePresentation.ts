// ============================================================
// 地図上の車両の見かけサイズ（純粋ロジック）。本番 /admin/map と検討用プレビューで共用する。
// 車両の長さを地図幅の約9%に保ち、寄って実寸に達したら等倍で止める（2026-09-02 プレビューで確定）。
// ============================================================

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAPBOX_TILE_SIZE = 512;

export const VEHICLE_TARGET_MAP_WIDTH_RATIO = 0.09;
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

export function vehicleMapPresentation({
  mapWidthPixels,
  zoom,
  latitude,
  vehicleLengthMeters = ACTY_HH5_LENGTH_METERS,
}: {
  mapWidthPixels: number;
  zoom: number;
  latitude: number;
  vehicleLengthMeters?: number;
}): VehicleMapPresentation {
  const width = Math.max(1, mapWidthPixels);
  const length = Math.max(0.1, vehicleLengthMeters);
  const safeLatitude = Math.min(85, Math.max(-85, latitude));
  const metersPerPixel = (
    Math.cos((safeLatitude * Math.PI) / 180) * EARTH_CIRCUMFERENCE_METERS
  ) / (MAPBOX_TILE_SIZE * Math.pow(2, zoom));
  const targetLengthPixels = width * VEHICLE_TARGET_MAP_WIDTH_RATIO;
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
