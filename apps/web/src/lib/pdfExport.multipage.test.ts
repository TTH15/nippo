// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// 複数ページPDF。選んだ範囲が枚数に分かれても「1ファイル」で渡せることを固定する
// （2026-09-19: 表示中のページしか保存されず、9/30 まで選んでも 9/20 で切れていた）。
const calls = vi.hoisted(() => ({ pages: [] as unknown[], images: [] as unknown[], ctor: [] as unknown[] }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 200, getHeight: () => 100 } };
    constructor(options: unknown) {
      calls.ctor.push(options);
    }
    addPage(format: unknown, orientation: unknown) {
      calls.pages.push({ format, orientation });
    }
    addImage(image: unknown) {
      calls.images.push(image);
    }
    output() {
      return new Blob(["pdf"], { type: "application/pdf" });
    }
  },
}));

import { pngsToPdf, pngToPdf } from "./pdfExport";

const page = (w: number, h: number) => ({ image: "data:image/png;base64,AAA", width: w, height: h });

describe("複数ページPDF", () => {
  it("2枚目以降だけ addPage する（1枚目は初期ページを使う）", async () => {
    calls.pages.length = 0;
    calls.images.length = 0;
    await pngsToPdf([page(1200, 600), page(1200, 900), page(600, 1200)]);
    expect(calls.images).toHaveLength(3);
    expect(calls.pages).toHaveLength(2);
  });

  it("ページごとに画像の比率へ用紙を合わせる", async () => {
    calls.pages.length = 0;
    await pngsToPdf([page(1200, 600), page(600, 1200)]);
    // 2枚目は縦長なので portrait
    expect(calls.pages[0]).toEqual({ format: [200, 400], orientation: "portrait" });
  });

  it("1枚だけなら addPage しない", async () => {
    calls.pages.length = 0;
    await pngToPdf("data:image/png;base64,AAA", 1200, 600);
    expect(calls.pages).toHaveLength(0);
  });

  it("空なら作らない", async () => {
    await expect(pngsToPdf([])).rejects.toThrow("画像がありません");
  });

  it("大きさが取れない画像は弾く", async () => {
    await expect(pngsToPdf([page(1200, 600), page(0, 100)])).rejects.toThrow("画像のサイズを取得できませんでした");
  });
});
