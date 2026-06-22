// 運転免許証の有効期限の判定ロジック（純粋・プラットフォーム非依存）。
// ドライバー管理の一覧表示・メニューバッジ（更新が迫っている人数）で同一のしきい値を
// 共有し、「画面ごとに警告基準が違う」不整合を防ぐ。oilChange.ts と同じ設計方針。

/** 免許期限判定に必要なドライバー情報の最小契約。 */
export type LicenseDriver = {
  license_expiry_date?: string | null;
};

export type LicenseLevel =
  | "unset" // 未設定（有効期限が登録されていない）
  | "safe" // 通常（2ヶ月より先）
  | "within2Months" // 2ヶ月以内（警告）
  | "within1Month" // 1ヶ月以内（重大）
  | "expired"; // 期限切れ（重大）

/**
 * 有効期限文字列（YYYY-MM-DD）から判定レベルを算出する。
 * - 未設定／不正な形式は "unset"。
 * - 期限当日以降は "expired"、1ヶ月前以降は "within1Month"、2ヶ月前以降は "within2Months"。
 * - now は基準日（既定は実行時の現在日）。日付のみで比較し時刻は無視する。
 */
export function computeLicenseLevel(
  dateStr?: string | null,
  now: Date = new Date(),
): LicenseLevel {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "unset";

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiry = new Date(`${dateStr}T00:00:00`);
  const oneMonthBefore = new Date(expiry);
  oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
  const twoMonthsBefore = new Date(expiry);
  twoMonthsBefore.setMonth(twoMonthsBefore.getMonth() - 2);

  if (today >= expiry) return "expired";
  if (today >= oneMonthBefore) return "within1Month";
  if (today >= twoMonthsBefore) return "within2Months";
  return "safe";
}

/**
 * 免許更新が迫っているドライバーか（2ヶ月以内・1ヶ月以内・期限切れ）。
 * 未設定・通常は対象外。
 */
export function isLicenseAlertDriver(
  driver: LicenseDriver,
  now: Date = new Date(),
): boolean {
  const level = computeLicenseLevel(driver.license_expiry_date, now);
  return level === "within2Months" || level === "within1Month" || level === "expired";
}

/** 更新が迫っている（接近 or 期限切れ）ドライバーの人数を数える。 */
export function countLicenseAlertDrivers(
  drivers: LicenseDriver[],
  now: Date = new Date(),
): number {
  return drivers.reduce((n, d) => (isLicenseAlertDriver(d, now) ? n + 1 : n), 0);
}
