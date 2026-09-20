import { describe, expect, it } from "vitest";
import { readCapturedAt } from "./imageMetadata";

// ============================================================
// 原本の中身から作成日時を読む。取れないこと（スクショ）も正しい結果として扱う。
// ============================================================

/** 最小のJPEG（SOI + APP1/Exif + EOI）を組み立てる */
function jpegWithExif(dateTimeOriginal: string, offsetTime?: string): Uint8Array {
  const entries: { tag: number; text: string }[] = [{ tag: 0x9003, text: dateTimeOriginal }];
  if (offsetTime) entries.push({ tag: 0x9011, text: offsetTime });

  // TIFF: ヘッダ(8) + IFD0(1件: ExifIFDポインタ) + ExifIFD(entries)
  const ifd0Offset = 8;
  const ifd0Size = 2 + 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifIfdSize = 2 + entries.length * 12 + 4;
  let dataOffset = exifIfdOffset + exifIfdSize;

  const parts: number[] = [];
  const push16 = (value: number) => parts.push((value >> 8) & 0xff, value & 0xff);
  const push32 = (value: number) => parts.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);

  parts.push(0x4d, 0x4d); // MM（ビッグエンディアン）
  push16(0x002a);
  push32(ifd0Offset);
  push16(1);
  push16(0x8769);
  push16(4);
  push32(1);
  push32(exifIfdOffset);
  push32(0);
  push16(entries.length);
  const tails: number[][] = [];
  for (const entry of entries) {
    const bytes = [...entry.text].map((c) => c.charCodeAt(0));
    bytes.push(0);
    push16(entry.tag);
    push16(2);
    push32(bytes.length);
    push32(dataOffset);
    tails.push(bytes);
    dataOffset += bytes.length;
  }
  push32(0);
  for (const tail of tails) parts.push(...tail);

  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...parts]; // "Exif\0\0" + TIFF
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...app1, 0xff, 0xd9]);
}

describe("原本の作成日時", () => {
  it("EXIFの撮影日時を日本時間として読む", () => {
    const result = readCapturedAt(jpegWithExif("2026:09:19 19:58:00"));
    expect(result.source).toBe("exif");
    expect(result.capturedAt).toBe("2026-09-19T10:58:00.000Z");
  });

  it("タイムゾーンが入っていればそれに従う", () => {
    const result = readCapturedAt(jpegWithExif("2026:09:19 19:58:00", "+00:00"));
    expect(result.capturedAt).toBe("2026-09-19T19:58:00.000Z");
  });

  it("日時を持たない画像は不明のままにする（スクショでは普通のこと）", () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xd9]);
    expect(readCapturedAt(plain)).toEqual({ capturedAt: null, source: "unknown" });
  });

  it("端末時計が狂った極端な値は採らない", () => {
    expect(readCapturedAt(jpegWithExif("1970:01:01 00:00:00")).capturedAt).toBeNull();
  });

  it("壊れたバイト列でも例外にしない", () => {
    expect(readCapturedAt(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toEqual({
      capturedAt: null,
      source: "unknown",
    });
  });
});
