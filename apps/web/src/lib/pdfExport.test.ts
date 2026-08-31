import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { pngToPdf } from "./pdfExport";

// 200×120pxの白地・罫線。実際のPNGを使い、jsPDFはモックしない。
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAIAAAA48Cq8AAABbElEQVR4nO3aoRGAMBQFQcJQDJoi6B2NppbQBKfYLSDq5se8sR/nAl9bP38RhEXFxSIhLBLCIiEsEsIiISwSY87ZvMyvuVgkhEVCWCSERUJYJIRFQlgkhEVCWCS2636al/m1YfNOwVdIQlgkhEVCWCSERUJYJIRFQlgkbN5JuFgkhEVCWCSERUJYJIRFQlgkhEVCWCRs3knYvJPwFZIQFglhkRAWCWGREBYJYZEQFgmbdxIuFglhkRAWCWGREBYJYZEQFglhkRAWCZt3EjbvJHyFJIRFQlgkhEVCWCSERUJYJIRFwuadhItFQlgkhEVCWCSERUJYJIRFQlgkhEXC5p2EzTsJXyEJYZEQFglhkRAWCWGREBYJYZGweSfhYpEQFglhkRAWCWGREBYJYZEQFglhkbB5J2HzTsJXSEJYJIRFQlgkhEVCWCSERUJYJGzeSbhYJIRFQlgkhEVCWCSERUJYJIRFQlgkbN5ZCi/EgSV1esoP9AAAAABJRU5ErkJggg==";

describe("PNGを画質を保ってPDFに格納する", () => {
  it("同じ画素数とページ寸法を保ち、非圧縮PDFの1割未満に収める", async () => {
    const before = new jsPDF({ orientation: "landscape", unit: "mm", format: [200, 120] });
    before.addImage(png, "PNG", 0, 0, 200, 120);
    const result = await pngToPdf(png, 200, 120);
    const bytes = await result.arrayBuffer();
    const output = new TextDecoder("latin1").decode(bytes);
    expect(result.type).toBe("application/pdf");
    expect(result.size).toBeLessThan(before.output("arraybuffer").byteLength / 10);
    expect(output).toContain("/Width 200");
    expect(output).toContain("/Height 120");
    expect(output).toContain("/FlateDecode");
    expect(output.match(/\/MediaBox \[[^\]]+\]/)?.[0]).toBe(before.output().match(/\/MediaBox \[[^\]]+\]/)?.[0]);
  });

  it.each([[0, 120], [200, Number.NaN], [200, Number.POSITIVE_INFINITY]])("無効な画像寸法をPDFへ渡さない（%s × %s）", async (width, height) => {
    await expect(pngToPdf(png, width, height)).rejects.toThrow("画像のサイズを取得できませんでした");
  });
});
