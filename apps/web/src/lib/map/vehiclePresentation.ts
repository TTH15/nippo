// ============================================================
// 地図上の車両の見かけサイズ（純粋ロジック）。本番 /admin/map と検討用プレビューで共用する。
//
// 車両の長さは「地図の短い辺の 14%」を目標にし、寄って実寸に達したら等倍で止める。
// ただし広域では車体を出さない。z13 未満は車が数kmの大きさになり、足元のリングが
// 市名を覆って地図が読めなくなるため、モデルとリングを消して札＋ドットだけにする
// （J-2 の判断・2026-09-08）。z13〜15 は 40px から目標へ線形に上げ、z15 以上で目標のまま。
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
/** これ未満のズームでは車体モデル・足元リングを描かない（札とドットだけにする） */
export const VEHICLE_MODEL_MIN_ZOOM = 13;
/** このズーム以上で目標サイズいっぱい。MIN との間は線形に立ち上げる */
export const VEHICLE_MODEL_FULL_ZOOM = 15;

export type VehicleMapPresentation = {
  /** 車体モデルと足元リングを描くか。false の広域では札＋ドットだけを出す */
  modelVisible: boolean;
  modelScale: number;
  targetLengthPixels: number;
  renderedLengthPixels: number;
  /** 足元のコントラストリング半径（px） */
  contrastRadiusPixels: number;
  /** ナンバー札を車両の上へ逃がす量（px） */
  markerOffsetPixels: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** z13 未満はモデルを描かない */
export function modelVisibleAtZoom(zoom: number): boolean {
  return zoom >= VEHICLE_MODEL_MIN_ZOOM;
}

/**
 * ズームに応じた目標の車両長（px）。
 * z13 で 40px、z15 で満額、その間は線形。z13 未満は 0（描かない）。
 */
export function targetLengthForZoom(fullTargetPixels: number, zoom: number): number {
  if (!modelVisibleAtZoom(zoom)) return 0;
  if (zoom >= VEHICLE_MODEL_FULL_ZOOM) return fullTargetPixels;
  const t = (zoom - VEHICLE_MODEL_MIN_ZOOM) / (VEHICLE_MODEL_FULL_ZOOM - VEHICLE_MODEL_MIN_ZOOM);
  return VEHICLE_TARGET_MIN_PIXELS + (fullTargetPixels - VEHICLE_TARGET_MIN_PIXELS) * t;
}

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
  const fullTarget = targetVehicleLengthPixels({ mapWidthPixels, mapHeightPixels, pitch });
  const modelVisible = modelVisibleAtZoom(zoom);
  // 広域では描かないが、札の逃がし量などは 0 除算にならない値を返しておく
  const targetLengthPixels = modelVisible ? targetLengthForZoom(fullTarget, zoom) : 0;
  const actualLengthPixels = length / metersPerPixel;
  const modelScale = Math.max(1, targetLengthPixels / actualLengthPixels);
  const renderedLengthPixels = modelVisible ? actualLengthPixels * modelScale : 0;

  return {
    modelVisible,
    modelScale,
    targetLengthPixels,
    renderedLengthPixels,
    contrastRadiusPixels: modelVisible ? Math.max(10, renderedLengthPixels * 0.46) : 0,
    // 車体が無い広域でも、札を縮退ドット（アンカーの 6px 上・直径 12px）より
    // 上へ逃がす。18px だと札の下端とドットが接して読みにくかった（2026-09-08 実画面）。
    markerOffsetPixels: modelVisible ? Math.max(28, renderedLengthPixels * 0.62) : 32,
  };
}

/** 前回値からの差が描画に影響するときだけ true（毎フレームの setPaintProperty を避ける） */
export function presentationChanged(
  previous: VehicleMapPresentation | null,
  next: VehicleMapPresentation,
): { scale: boolean; contrast: boolean; offset: boolean } {
  if (!previous) return { scale: true, contrast: true, offset: true };
  // 表示・非表示の切り替わりは必ず反映する（閾値では拾えない）
  if (previous.modelVisible !== next.modelVisible) return { scale: true, contrast: true, offset: true };
  return {
    scale: Math.abs(next.modelScale - previous.modelScale) > Math.max(0.002, next.modelScale * 0.001),
    contrast: Math.abs(next.contrastRadiusPixels - previous.contrastRadiusPixels) >= 0.1,
    offset: Math.abs(next.markerOffsetPixels - previous.markerOffsetPixels) >= 0.25,
  };
}
