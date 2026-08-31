import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import html2canvas from "html2canvas";
import { renderPlateImage } from "./plateImage";
import { captureDispatchImage } from "./captureDispatchImage";

vi.mock("html2canvas", () => ({ default: vi.fn() }));
vi.mock("./plateImage", () => ({ renderPlateImage: vi.fn() }));
const canvas = { width: 1224, height: 300, toDataURL: () => "data:image/png;base64,cG5n", toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"])) };
beforeEach(() => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
  vi.mocked(renderPlateImage).mockResolvedValue({ canvas: canvas as unknown as HTMLCanvasElement, width: 88, height: 44, padding: 16 });
  vi.mocked(html2canvas).mockResolvedValue(canvas as unknown as HTMLCanvasElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); document.body.replaceChildren(); });
describe("日別配車の画像化", () => {
  it("SVGの面だけ差し替え、警告と番号未登録車を残し、10件ずつ分割する", async () => {
    const source = document.createElement("div");
    source.innerHTML = Array.from({ length: 12 }, (_, i) => `<div data-export-row>運転者${i}<span data-export-omit>タップで割当</span><span data-mobile-export-plate="true" data-mobile-export-plate-id="v${i}" data-mobile-export-plate-kana="れ" data-mobile-export-plate-number="1201"><div>${i === 11 ? "番号未登録車" : '<div style="aspect-ratio: 2 / 1">SVG面</div>'}<span role="status">使用不可</span></div></span></div>`).join("");
    document.body.append(source);
    let captured = "";
    vi.mocked(html2canvas).mockImplementation(async stage => { captured = stage.innerHTML; return canvas as unknown as HTMLCanvasElement; });
    const result = await captureDispatchImage(source, { title: "配車", subtitle: "全員12人", page: 1, pageCount: 2 });
    expect(captured).toContain("運転者10"); expect(captured).toContain("運転者11"); expect(captured).not.toContain("運転者9");
    expect(captured).toContain("使用不可"); expect(captured).toContain("番号未登録車");
    expect(captured).not.toContain("タップで割当"); expect(captured).not.toContain("SVG面");
    expect(renderPlateImage).toHaveBeenCalledTimes(1);
    expect(result.url).toBe(canvas.toDataURL());
    expect(source.querySelectorAll("[data-export-row]")).toHaveLength(12);
    expect(document.body.children).toHaveLength(1);
  });
  it("素材の生成に失敗した場合も一時DOMを撤去する", async () => {
    const source = document.createElement("div");
    source.innerHTML = '<span data-mobile-export-plate="true"><div style="aspect-ratio: 2 / 1"></div></span>';
    document.body.append(source);
    vi.mocked(renderPlateImage).mockRejectedValueOnce(new Error("SVG unavailable"));
    await expect(captureDispatchImage(source, { title: "配車", subtitle: "稼働", page: 0, pageCount: 1 })).rejects.toThrow("SVG unavailable");
    expect(document.body.children).toHaveLength(1);
    expect(html2canvas).not.toHaveBeenCalled();
  });
  it.each([false, true])("画像生成中だけ非表示の文字計測画像をinlineに戻し、画面の画像は変えない（失敗: %s）", async fail => {
    const reset = document.createElement("style");
    reset.textContent = "img { display: block; }";
    document.head.append(reset);
    const source = document.createElement("div");
    const visibleImage = document.createElement("img");
    visibleImage.width = 1; visibleImage.height = 1;
    source.append(visibleImage); document.body.append(source);
    const probe = document.createElement("div");
    probe.style.visibility = "hidden";
    const measurementImage = document.createElement("img");
    measurementImage.width = 1; measurementImage.height = 1;
    probe.append(measurementImage); document.body.append(probe);
    const originalStyles = document.head.querySelectorAll("style").length;
    try {
      expect(getComputedStyle(measurementImage).display).toBe("block");
      vi.mocked(html2canvas).mockImplementation(async () => {
        // ライブラリ同様、クローンではなく元documentで計測する。
        expect(getComputedStyle(measurementImage).display).toBe("inline-block");
        expect(getComputedStyle(visibleImage).display).toBe("block");
        if (fail) throw new Error("capture failed");
        return canvas as unknown as HTMLCanvasElement;
      });
      const capture = captureDispatchImage(source, { title: "配車", subtitle: "稼働", page: 0, pageCount: 1 });
      if (fail) await expect(capture).rejects.toThrow("capture failed");
      else await capture;
      expect(getComputedStyle(measurementImage).display).toBe("block");
      expect(document.head.querySelectorAll("style")).toHaveLength(originalStyles);
      expect(document.body.children).toHaveLength(2);
    } finally { reset.remove(); }
  });
});
