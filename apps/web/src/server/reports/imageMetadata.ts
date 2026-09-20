// ============================================================
// 受け取った原本のバイト列から「画像の作成日時」を取り出す。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2）
//
// 端末の申告ではなくサーバーがファイルの中身から読む。取れなければ「不明」のままにし、
// 受領時刻やファイルの更新日時で埋めない。
//
// 実測（2026-09-19）: iPhoneのスクショをLINE経由で受け取った画像には EXIF の
// 撮影日時が無かった（解像度とサムネイルだけ）。**スクショは日時を持たないのが普通**で、
// 取れたら使う程度の手がかりとして扱う。日時が無いことを異常として扱わない。
//
// EXIF の日時はタイムゾーンを持たない（端末のローカル時刻がそのまま入る）。
// OffsetTimeOriginal があればそれを使い、無ければ日本時間として読む（国内専業のため）。
// ============================================================

import { DEFAULT_TZ_OFFSET, exifDateTimeToIso } from "@repo/core/logic/imageCapturedAt";

export type CapturedAtSource = "exif" | "photo_library" | "unknown";
export type CapturedAt = { capturedAt: string | null; source: CapturedAtSource };

const NONE: CapturedAt = { capturedAt: null, source: "unknown" };
/** 日本時間。EXIF にオフセットが無いときの既定（解釈は @repo/core と共有する） */
const JST_OFFSET = DEFAULT_TZ_OFFSET;
const toIso = exifDateTimeToIso;

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = "";
  for (let i = 0; i < length && start + i < bytes.length; i += 1) {
    const code = bytes[start + i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
};

const EXIF_TAGS = {
  dateTime: 0x0132,
  exifIfd: 0x8769,
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  offsetTimeOriginal: 0x9011,
  offsetTime: 0x9010,
} as const;

/** JPEG の APP1（Exif）から作成日時を読む */
function readJpegExif(bytes: Uint8Array): CapturedAt {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  // セグメントを辿って APP1 を探す（画像本体に入る前で打ち切る）
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === "Exif") {
      return readTiff(bytes, offset + 10);
    }
    offset += 2 + length;
  }
  return NONE;
}

/** TIFF ヘッダ（Exif の本体）から日時タグを拾う */
function readTiff(bytes: Uint8Array, base: number): CapturedAt {
  if (base + 8 > bytes.length) return NONE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = ascii(bytes, base, 2) === "II";
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(base + 2) !== 0x002a) return NONE;

  const found = new Map<number, string>();
  const readIfd = (ifdOffset: number, depth: number): void => {
    if (depth > 2 || ifdOffset <= 0 || base + ifdOffset + 2 > bytes.length) return;
    const entryCount = u16(base + ifdOffset);
    if (entryCount > 512) return;
    for (let i = 0; i < entryCount; i += 1) {
      const entry = base + ifdOffset + 2 + i * 12;
      if (entry + 12 > bytes.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      if (tag === EXIF_TAGS.exifIfd) {
        readIfd(u32(entry + 8), depth + 1);
        continue;
      }
      const wanted =
        tag === EXIF_TAGS.dateTime ||
        tag === EXIF_TAGS.dateTimeOriginal ||
        tag === EXIF_TAGS.dateTimeDigitized ||
        tag === EXIF_TAGS.offsetTimeOriginal ||
        tag === EXIF_TAGS.offsetTime;
      if (!wanted || type !== 2 || count === 0 || count > 64) continue;
      const valueOffset = count <= 4 ? entry + 8 : base + u32(entry + 8);
      found.set(tag, ascii(bytes, valueOffset, count));
    }
  };
  readIfd(u32(base + 4), 0);

  const offsetText = found.get(EXIF_TAGS.offsetTimeOriginal) ?? found.get(EXIF_TAGS.offsetTime) ?? "";
  const offset = /^[+-]\d{2}:\d{2}$/.test(offsetText.trim()) ? offsetText.trim() : JST_OFFSET;
  const raw =
    found.get(EXIF_TAGS.dateTimeOriginal) ?? found.get(EXIF_TAGS.dateTimeDigitized) ?? found.get(EXIF_TAGS.dateTime);
  if (!raw) return NONE;
  const capturedAt = toIso(raw, offset);
  return capturedAt ? { capturedAt, source: "exif" } : NONE;
}

/** PNG の tEXt / iTXt（Creation Time）と XMP の CreateDate を見る */
function readPngText(bytes: Uint8Array): CapturedAt {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    if (type === "IDAT" || type === "IEND") break;
    if (length > bytes.length) break;
    if (type === "tEXt" || type === "iTXt" || type === "eXIf") {
      if (type === "eXIf") {
        const exif = readTiff(bytes, dataStart);
        if (exif.capturedAt) return exif;
      } else {
        const text = ascii(bytes, dataStart, Math.min(length, 512));
        const rest = new TextDecoder("utf-8", { fatal: false }).decode(
          bytes.subarray(dataStart, dataStart + Math.min(length, 2048)),
        );
        if (text.startsWith("Creation Time")) {
          const value = rest.slice(text.length).replace(/^\0+/, "").trim();
          const parsed = Date.parse(value);
          if (!Number.isNaN(parsed)) return { capturedAt: new Date(parsed).toISOString(), source: "exif" };
          const iso = toIso(value, JST_OFFSET);
          if (iso) return { capturedAt: iso, source: "exif" };
        }
        const xmp = rest.match(/xmp:CreateDate="?([^"<\s]+)/);
        if (xmp) {
          const parsed = Date.parse(xmp[1]);
          if (!Number.isNaN(parsed)) return { capturedAt: new Date(parsed).toISOString(), source: "exif" };
        }
      }
    }
    offset = dataStart + length + 4;
  }
  return NONE;
}

/**
 * 原本の中身から作成日時を読む。取れなければ「不明」。
 * スクショは日時を持たないことが多く、それ自体は異常ではない。
 */
export function readCapturedAt(bytes: Uint8Array): CapturedAt {
  if (!bytes || bytes.length < 16) return NONE;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegExif(bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return readPngText(bytes);
  } catch {
    // 壊れたメタデータで提出を止めない
  }
  return NONE;
}
