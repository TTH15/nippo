// オイル交換時期の判定ロジック（純粋・プラットフォーム非依存）。
// ドライバー画面（走行距離入力時の警告）・運営画面（一覧/メニューバッジ/集計）で
// 同一のしきい値を共有し、「画面ごとに警告基準が違う」不整合を防ぐ。

/** オイル交換判定に必要な車両情報の最小契約。 */
export type OilVehicle = {
  current_mileage?: number | null;
  last_oil_change_mileage?: number | null;
  oil_change_interval?: number | null;
  is_ev?: boolean | null;
  is_disposed?: boolean | null;
};

/** 残りkmがこの値以下で「接近（警告）」。 */
export const OIL_WARN_KM = 300;
/** 残りkmがこの値未満で「要交換（重大）」。超過（マイナス）も含む。 */
export const OIL_CRITICAL_KM = 100;

export type OilLevel = "safe" | "warn" | "critical";

export type OilStatus = {
  lastOil: number;
  interval: number;
  /** 判定に用いた現在走行距離（入力値 > 登録メーター）。 */
  currentKm: number;
  nextOilChangeKm: number;
  /** 次回交換までの残りkm（マイナスは超過）。 */
  remaining: number;
  /** 0–100 の進捗（前回交換から次回までの割合）。 */
  oilProgress: number;
  level: OilLevel;
};

/**
 * 車両と（任意の）入力中メーター値からオイル交換状況を算出する。
 * - 交換間隔が未設定/0 の場合は null（判定対象外）。
 * - EV は判定対象外（null）。
 * - meterStr を渡すと入力中の値で先読み判定し、空なら登録メーターを使う。
 */
export function computeOilStatus(
  vehicle: OilVehicle | null,
  meterStr = "",
): OilStatus | null {
  if (!vehicle) return null;
  if (vehicle.is_ev) return null;
  const interval = vehicle.oil_change_interval ?? 0;
  if (!interval || interval <= 0) return null;

  const lastOil = vehicle.last_oil_change_mileage ?? 0;
  const entered = meterStr.trim() === "" ? null : Number(meterStr);
  const currentKm =
    entered != null && Number.isFinite(entered) && entered > 0
      ? entered
      : vehicle.current_mileage || 0;

  const nextOilChangeKm = lastOil + interval;
  const remaining = nextOilChangeKm - currentKm;
  const oilProgress = Math.max(
    0,
    Math.min(100, ((currentKm - lastOil) / interval) * 100),
  );

  let level: OilLevel = "safe";
  if (remaining < OIL_CRITICAL_KM) level = "critical";
  else if (remaining <= OIL_WARN_KM) level = "warn";

  return { lastOil, interval, currentKm, nextOilChangeKm, remaining, oilProgress, level };
}

/** 車両がオイル交換の警告対象（接近 or 要交換）かどうか。廃車・EVは対象外。 */
export function isOilAlertVehicle(vehicle: OilVehicle): boolean {
  if (vehicle.is_disposed) return false;
  const status = computeOilStatus(vehicle);
  return status != null && status.level !== "safe";
}

/** 交換が迫っている（接近 or 要交換）車両の台数を数える。 */
export function countOilAlertVehicles(vehicles: OilVehicle[]): number {
  return vehicles.reduce((n, v) => (isOilAlertVehicle(v) ? n + 1 : n), 0);
}
