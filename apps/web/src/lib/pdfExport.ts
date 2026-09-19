import type { jsPDFOptions } from "jspdf";

/** 圧縮なしではPNGの展開済み画素やフォントが膨らむ。画質を変えず圧縮する。 */
export const PDF_EXPORT_OPTIONS = { compress: true, putOnlyUsedFonts: true } satisfies jsPDFOptions;

export type PngPage = { image: string; width: number; height: number };

/** プレビューと同じPNGを、画素・縦横比を変えず1ページのPDFへ格納する。 */
export async function pngToPdf(image: string, width: number, height: number): Promise<Blob> {
  return pngsToPdf([{ image, width, height }]);
}

/**
 * 複数のPNGを1つのPDFへ。ページごとに用紙の向き・比率を画像に合わせる。
 * 枚数に分かれた出力を「1ファイル」で渡せるようにするため（2026-09-19 シフト表の出力）。
 */
export async function pngsToPdf(pages: readonly PngPage[]): Promise<Blob> {
  if (pages.length === 0) throw new Error("画像がありません");
  for (const { width, height } of pages) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("画像のサイズを取得できませんでした");
    }
  }
  const { jsPDF } = await import("jspdf");
  const sizeOf = (page: PngPage) => {
    const pageWidth = 200;
    return { pageWidth, pageHeight: pageWidth * page.height / page.width };
  };
  const first = sizeOf(pages[0]);
  const pdf = new jsPDF({
    ...PDF_EXPORT_OPTIONS,
    orientation: first.pageWidth >= first.pageHeight ? "landscape" : "portrait",
    unit: "mm",
    format: [first.pageWidth, first.pageHeight],
  });
  pages.forEach((page, index) => {
    const { pageWidth, pageHeight } = sizeOf(page);
    if (index > 0) {
      pdf.addPage([pageWidth, pageHeight], pageWidth >= pageHeight ? "landscape" : "portrait");
    }
    pdf.addImage(page.image, "PNG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, "SLOW");
  });
  return pdf.output("blob");
}
