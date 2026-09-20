// ============================================================
// 画像の作成日時の解釈（プラットフォーム非依存）。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2 / RIMG-5）
//
// EXIF の日時はタイムゾーンを持たない（端末のローカル時刻がそのまま入る）。
// オフセットが取れなければ日本時間として読む（国内専業のため）。
// 取れなかった日時は「不明」のままにし、現在時刻で埋めない。
// ============================================================

/** 日本時間。EXIF にオフセットが無いときの既定 */
export const DEFAULT_TZ_OFFSET = "+09:00";

/** 端末時計の初期化などで入る極端な値の下限 */
const EARLIEST = Date.UTC(2000, 0, 1);

/**
 * "2026:09:19 19:58:00" 形式（EXIF）や "2026-09-19T19:58:00" を ISO にする。
 * 読めない・古すぎる値は null（＝不明）。
 */
export function exifDateTimeToIso(value: unknown, offset: string = DEFAULT_TZ_OFFSET): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})[:\-/](\d{2})[:\-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const tz = /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : DEFAULT_TZ_OFFSET;
  const time = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`);
  if (Number.isNaN(time) || time < EARLIEST) return null;
  return new Date(time).toISOString();
}

export type PickedCapturedAt = {
  capturedAt: string | null;
  source: "exif" | "photo_library" | "unknown";
};

/**
 * 写真選択で受け取ったメタデータから作成日時を決める。
 * EXIF の撮影日時があればそれを使い、無ければ写真ライブラリの作成時刻を使う。
 * どちらも無ければ「不明」。**受領時刻やファイルの更新日時で埋めない。**
 */
export function capturedAtFromPicked(
  exif: Record<string, unknown> | null | undefined,
  libraryCreationTimeMs?: number | null,
): PickedCapturedAt {
  const offset =
    typeof exif?.OffsetTimeOriginal === "string"
      ? exif.OffsetTimeOriginal
      : typeof exif?.OffsetTime === "string"
        ? exif.OffsetTime
        : DEFAULT_TZ_OFFSET;
  const fromExif =
    exifDateTimeToIso(exif?.DateTimeOriginal, offset) ??
    exifDateTimeToIso(exif?.DateTimeDigitized, offset) ??
    exifDateTimeToIso(exif?.DateTime, offset);
  if (fromExif) return { capturedAt: fromExif, source: "exif" };

  if (typeof libraryCreationTimeMs === "number" && libraryCreationTimeMs > EARLIEST) {
    return { capturedAt: new Date(libraryCreationTimeMs).toISOString(), source: "photo_library" };
  }
  return { capturedAt: null, source: "unknown" };
}
