import { describe, it, expect } from "vitest";
import { isDataUrl, decodeDataUrl, extensionForMime } from "./dataUrl";

// data URL → Storage 移行の判定部分。
// 既存データ（data URL のまま DB にある）と移行後（path）が混在するため、
// 判別を誤ると画像が表示されない／二重アップロードになる。
describe("isDataUrl", () => {
  it("data URL を判別する", () => {
    expect(isDataUrl("data:image/png;base64,AAAA")).toBe(true);
  });

  it("Storage のパスは data URL ではない", () => {
    expect(isDataUrl("vehicles/abc-123.jpg")).toBe(false);
  });

  it("空・null は false", () => {
    expect(isDataUrl("")).toBe(false);
    expect(isDataUrl(null)).toBe(false);
    expect(isDataUrl(undefined)).toBe(false);
  });
});

describe("decodeDataUrl", () => {
  it("MIME とバイト列を復元する", () => {
    // "hi" を base64 にしたもの
    const decoded = decodeDataUrl("data:image/png;base64,aGk=");
    expect(decoded?.mime).toBe("image/png");
    expect(decoded?.bytesLength).toBe(2);
    expect(Array.from(decoded!.bytes)).toEqual([104, 105]);
  });

  it("形式が違えば null（不正値でアップロードしない）", () => {
    expect(decodeDataUrl("https://example.com/a.png")).toBeNull();
    expect(decodeDataUrl("data:image/png,notbase64")).toBeNull();
    expect(decodeDataUrl("")).toBeNull();
  });
});

describe("extensionForMime", () => {
  it("既知の形式はそれぞれの拡張子", () => {
    expect(extensionForMime("application/pdf")).toBe("pdf");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/webp")).toBe("webp");
  });

  it("未知・JPEG は jpg に寄せる", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("application/octet-stream")).toBe("jpg");
  });
});
