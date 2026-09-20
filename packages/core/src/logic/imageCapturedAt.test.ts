import { describe, expect, it } from "vitest";
import { capturedAtFromPicked, exifDateTimeToIso } from "./imageCapturedAt";

describe("画像の作成日時", () => {
  it("EXIFの形式を日本時間として読む", () => {
    expect(exifDateTimeToIso("2026:09:19 19:58:00")).toBe("2026-09-19T10:58:00.000Z");
  });

  it("オフセットが取れればそれに従う", () => {
    expect(exifDateTimeToIso("2026:09:19 19:58:00", "+00:00")).toBe("2026-09-19T19:58:00.000Z");
  });

  it("読めない値・古すぎる値は不明にする", () => {
    expect(exifDateTimeToIso("きのう")).toBeNull();
    expect(exifDateTimeToIso("1970:01:01 00:00:00")).toBeNull();
    expect(exifDateTimeToIso(undefined)).toBeNull();
  });

  it("EXIFがあればEXIFを使う", () => {
    expect(capturedAtFromPicked({ DateTimeOriginal: "2026:09:19 19:58:00" }, 1)).toEqual({
      capturedAt: "2026-09-19T10:58:00.000Z",
      source: "exif",
    });
  });

  it("EXIFが無ければ写真ライブラリの作成時刻を使う", () => {
    const result = capturedAtFromPicked(null, Date.UTC(2026, 8, 19, 10, 58));
    expect(result.source).toBe("photo_library");
    expect(result.capturedAt).toBe("2026-09-19T10:58:00.000Z");
  });

  it("どちらも無ければ不明のままにする（現在時刻で埋めない）", () => {
    expect(capturedAtFromPicked(null, null)).toEqual({ capturedAt: null, source: "unknown" });
    expect(capturedAtFromPicked({}, 0)).toEqual({ capturedAt: null, source: "unknown" });
  });
});
