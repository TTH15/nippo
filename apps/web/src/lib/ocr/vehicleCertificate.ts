import { vehicleIdentityForCode } from "@/lib/vehicleModels";

export const CERTIFICATE_FIELDS = {
  numberPrefix: "地域", numberClass: "分類番号", numberHiragana: "ひらがな", numberNumeric: "一連番号",
  manufacturer: "メーカー", brand: "車種", modelCode: "型式", nextShakenDate: "車検満了日",
} as const;
export type CertificateField = keyof typeof CERTIFICATE_FIELDS;
export type VehicleCertificateDraft = Record<CertificateField, string>;
export const emptyCertificate = (): VehicleCertificateDraft => ({
  numberPrefix: "", numberClass: "", numberHiragana: "", numberNumeric: "", manufacturer: "", brand: "", modelCode: "", nextShakenDate: "",
});

export type CertificateWord = { text: string; bbox: { x0: number; x1: number; y0: number; y1: number } };
/** OCRが表を「左列全部→右列全部」の順に返しても、見えている行へ並べ直す。 */
export function certificateTextFromWords(words: readonly CertificateWord[]): string {
  const rows: { y: number; height: number; words: CertificateWord[] }[] = [];
  for (const word of [...words].filter(w => w.text.trim()).sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1))) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2, height = word.bbox.y1 - word.bbox.y0;
    const row = rows.find(r => Math.abs(r.y - y) <= Math.max(r.height, height) * 0.65);
    if (row) row.words.push(word); else rows.push({ y, height, words: [word] });
  }
  return rows.map(r => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(" ")).join("\n");
}

function dateFromCertificate(text: string): string {
  const m = text.match(/(?:(令和|平成|昭和|R|H|S)\.?)(元|\d{1,2})[年./-](\d{1,2})[月./-](\d{1,2})日?/i)
    ?? text.match(/()(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (!m) return "";
  const era = m[1].toUpperCase();
  const n = m[2] === "元" ? 1 : Number(m[2]);
  const year = n + ({ "令和": 2018, R: 2018, "平成": 1988, H: 1988, "昭和": 1925, S: 1925 }[era] ?? 0);
  const month = Number(m[3]), day = Number(m[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1989 || year > 2099 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** OCRは提案値だけ。見つからない項目・日付は推測しない。所有者・住所・検査時走行距離は取得しない。 */
export function parseVehicleCertificate(text: string): VehicleCertificateDraft {
  const result = emptyCertificate();
  const compact = text.normalize("NFKC").replace(/[‐‑−–—]/g, "-").replace(/[\s|｜]/g, "");
  const maker = compact.match(/車名[:：]?(スズキ|SUZUKI|日産|ニッサン|ダイハツ|三菱|ミツビシ|ホンダ|トヨタ|マツダ|スバル)/i)?.[1];
  if (maker) result.manufacturer = ({ SUZUKI: "スズキ", "ニッサン": "日産", "ミツビシ": "三菱" }[maker.toUpperCase()] ?? maker);
  result.modelCode = compact.match(/(?<!原動機の)(?<!原動機)型式[:：]?([A-Z0-9][A-Z0-9-]{2,28}(?:改)?)/i)?.[1]?.toUpperCase() ?? "";
  const identity = vehicleIdentityForCode(result.modelCode, result.manufacturer);
  if (identity) { result.manufacturer = identity.manufacturer; result.brand = identity.brand; }
  // 書類見出しの直後だけを見る。住所や車台番号の数字列をナンバーとして採用しない。
  const plate = compact.match(/(?:自動車登録番号(?:又は車両番号)?|車両番号)[:：]?([一-龯ぁ-んヶ]{1,6})([0-9A-Z]{2,3})([ぁ-ん])([0-9・.\-]{1,7})/i);
  if (plate) {
    const digits = plate[4].replace(/\D/g, "");
    if (digits.length >= 1 && digits.length <= 4) {
      result.numberPrefix = plate[1]; result.numberClass = plate[2].toUpperCase();
      result.numberHiragana = plate[3]; result.numberNumeric = digits;
    }
  }
  const expiry = compact.match(/(?:有効期間の満了する日|有効期間満了日)[:：]?((?:令和|平成|昭和|R|H|S|20)[0-9元年月日./-]{5,18})/i);
  if (expiry) result.nextShakenDate = dateFromCertificate(expiry[1]);
  return result;
}

export function selectedCertificatePatch(draft: VehicleCertificateDraft, selected: readonly CertificateField[]): Partial<VehicleCertificateDraft> {
  return Object.fromEntries(selected.filter(key => draft[key].trim()).map(key => [key, draft[key].trim()]));
}
