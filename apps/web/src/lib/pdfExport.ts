import type { jsPDFOptions } from "jspdf";

/** 圧縮なしではPNGの展開済み画素やフォントが膨らむ。画質を変えず圧縮する。 */
export const PDF_EXPORT_OPTIONS = { compress: true, putOnlyUsedFonts: true } satisfies jsPDFOptions;

/** プレビューと同じPNGを、画素・縦横比を変えず1ページのPDFへ格納する。 */
export async function pngToPdf(image: string, width: number, height: number): Promise<Blob> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("画像のサイズを取得できませんでした");
  }
  const { jsPDF } = await import("jspdf");
  const pageWidth = 200;
  const pageHeight = pageWidth * height / width;
  const pdf = new jsPDF({
    ...PDF_EXPORT_OPTIONS,
    orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
    unit: "mm",
    format: [pageWidth, pageHeight],
  });
  pdf.addImage(image, "PNG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, "SLOW");
  return pdf.output("blob");
}
