import { describe, it, expect } from "vitest";
import { detectFileType, verifyFileContent } from "./fileSignature";

// ============================================================
// アップロードの中身検査。
// MIME や拡張子は自己申告で偽装できるため、実体（先頭バイト）で判定する。
// ここが緩むと「画像と称した HTML/スクリプト」が署名URLで配信されうる。
// ============================================================

/** 先頭に署名を置いたダミーファイルを作る（12バイト以上にする）。 */
function fileWith(signature: number[]): Uint8Array {
  const bytes = new Uint8Array(64);
  signature.forEach((b, i) => (bytes[i] = b));
  return bytes;
}

const JPEG = fileWith([0xff, 0xd8, 0xff, 0xe0]);
const PNG = fileWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = fileWith([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const WEBP = (() => {
  const b = new Uint8Array(64);
  [0x52, 0x49, 0x46, 0x46].forEach((v, i) => (b[i] = v)); // RIFF
  [0x57, 0x45, 0x42, 0x50].forEach((v, i) => (b[8 + i] = v)); // WEBP
  return b;
})();
/** `<html>` で始まる偽装ファイル。 */
const HTML = (() => {
  const text = "<html><script>alert(1)</script></html>";
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
})();
/** `<svg>` — スクリプトを埋め込めるため許可しない。 */
const SVG = (() => {
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>';
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
})();

const IMAGE_ONLY = ["image/jpeg", "image/png"] as const;
const WITH_PDF = ["application/pdf", "image/jpeg", "image/png"] as const;

describe("detectFileType", () => {
  it("実体から形式を判定する", () => {
    expect(detectFileType(JPEG)).toBe("image/jpeg");
    expect(detectFileType(PNG)).toBe("image/png");
    expect(detectFileType(PDF)).toBe("application/pdf");
    expect(detectFileType(WEBP)).toBe("image/webp");
  });

  it("既知の形式でなければ null（default-deny）", () => {
    expect(detectFileType(HTML)).toBeNull();
    expect(detectFileType(SVG)).toBeNull();
    expect(detectFileType(new Uint8Array(64))).toBeNull();
  });
});

describe("verifyFileContent", () => {
  it("許可された形式は通す", () => {
    expect(verifyFileContent(JPEG, IMAGE_ONLY)).toEqual({ ok: true, type: "image/jpeg" });
    expect(verifyFileContent(PDF, WITH_PDF)).toEqual({ ok: true, type: "application/pdf" });
  });

  it("★画像と偽ったHTMLを拒否する（偽装の中核ケース）", () => {
    const res = verifyFileContent(HTML, IMAGE_ONLY, "image/png");
    expect(res.ok).toBe(false);
  });

  it("★SVG は画像だが許可しない（スクリプトを埋め込めるため）", () => {
    expect(verifyFileContent(SVG, IMAGE_ONLY, "image/svg+xml").ok).toBe(false);
  });

  it("★申告と実体が食い違えば拒否する（PDFをPNGと偽る）", () => {
    const res = verifyFileContent(PDF, WITH_PDF, "image/png");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("一致しません");
  });

  it("許可リストに無い形式は、実体が正しくても拒否する", () => {
    // WebP は判定できるが、画像のみ許可の場面では通さない
    expect(verifyFileContent(WEBP, IMAGE_ONLY).ok).toBe(false);
    // PDF も画像のみの場面では通さない
    expect(verifyFileContent(PDF, IMAGE_ONLY).ok).toBe(false);
  });

  it("image/jpg という別名表記は image/jpeg と同一視する", () => {
    expect(verifyFileContent(JPEG, IMAGE_ONLY, "image/jpg").ok).toBe(true);
  });

  it("空・極端に短いファイルは拒否する", () => {
    expect(verifyFileContent(new Uint8Array(0), IMAGE_ONLY).ok).toBe(false);
    expect(verifyFileContent(new Uint8Array([0xff, 0xd8, 0xff]), IMAGE_ONLY).ok).toBe(false);
  });
});
