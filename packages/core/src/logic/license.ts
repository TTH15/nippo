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

// ============================================================
// 免許証 OCR テキストから有効期限を抽出する（純粋・プラットフォーム非依存）。
// 端末側 OCR（ML Kit）の生テキストを入力し、"YYYY-MM-DD" を返す。
// 自動確定はせずプリフィル用途（ユーザーが確認・修正する前提）。
// ============================================================

const ERA_OFFSET: Record<string, number> = { 令和: 2018, 平成: 1988, 昭和: 1925 };

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 全角数字・全角空白を半角へ。 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

type DateCand = { ymd: string; end: number };

function pushDate(out: DateCand[], year: number, month: number, day: number, end: number): void {
  if (month < 1 || month > 12 || day < 1 || day > 31) return;
  out.push({ ymd: `${year}-${pad2(month)}-${pad2(day)}`, end });
}

/**
 * 免許証 OCR テキストから有効期限（YYYY-MM-DD）を推定する。見つからなければ null。
 * - 和暦（令和/平成/昭和）と西暦の「○年○月○日」を抽出。
 * - 「有効」直前の日付を優先（免許の "…まで有効" バンド）。無ければ最も新しい日付。
 */
export function parseLicenseExpiryFromOcr(text: string): string | null {
  if (!text) return null;
  // 現代の免許は「2028年（令和10年）08月23日まで有効」のように西暦と（元号）が併記され、
  // 括弧が年と月の間に挟まる。括弧内を除去してから抽出する（西暦年を採用）。
  const t = toHalfWidth(text).replace(/[（(][^）)]*[）)]/g, " ");
  const cands: DateCand[] = [];

  const eraRe = /(令和|平成|昭和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  let m: RegExpExecArray | null;
  while ((m = eraRe.exec(t)) !== null) {
    pushDate(cands, ERA_OFFSET[m[1]] + Number(m[2]), Number(m[3]), Number(m[4]), m.index + m[0].length);
  }
  const westRe = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  while ((m = westRe.exec(t)) !== null) {
    pushDate(cands, Number(m[1]), Number(m[2]), Number(m[3]), m.index + m[0].length);
  }
  if (cands.length === 0) return null;

  // 「…まで有効」の直前にある日付を優先。
  const idx = t.indexOf("有効");
  if (idx >= 0) {
    const before = cands.filter((c) => c.end <= idx).sort((a, b) => b.end - a.end);
    if (before.length > 0) return before[0].ymd;
  }
  // フォールバック: 最も新しい日付（YYYY-MM-DD は辞書順＝日付順）。
  return cands.map((c) => c.ymd).sort().slice(-1)[0];
}
