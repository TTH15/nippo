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
});
