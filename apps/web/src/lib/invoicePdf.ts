// 請求書（React帳票）の PDF 出力。A4 1枚に収まらない場合は自然な改行位置（行）で
// 複数ページへ分割する。html2canvas + jsPDF（いずれも依存導入済み）。

/** 対象期間と請求元名から PDF ファイル名を生成。例: 202505_5月分御請求書_株式会社ACE CREATION.pdf */
export function invoicePdfFileName(period: string, fromName: string): string {
  let yearMonth = "";
  let monthLabel = "";
  const m = String(period || "").match(/(\d{4})年(\d{1,2})月/);
  if (m) {
    yearMonth = `${m[1]}${m[2].padStart(2, "0")}`;
    monthLabel = `${m[2]}月分`;
  } else {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    monthLabel = `${now.getMonth() + 1}月分`;
  }
  const safeName = String(fromName || "請求書").replace(/[\\/:*?"<>|]/g, "");
  return `${yearMonth}_${monthLabel}御請求書_${safeName}.pdf`;
}

/**
 * 帳票要素（A4の白いシート div）を PDF 化して保存する。
 * sheet は InvoiceDocument の sheetRef が指す要素（白地のA4本体）を渡す。
 */
export async function exportInvoicePdf(sheet: HTMLElement, fileName: string): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  // レンダリング安定待ち
  await new Promise((r) => setTimeout(r, 50));

  const canvas = await html2canvas(sheet, {
    scale: 3,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: sheet.scrollWidth,
    windowHeight: sheet.scrollHeight,
  });

  const pageWidthMm = 210;
  const pageHeightMm = 297;

  // DOM 上の1ページ分の高さ(px)と、改行候補（行の下端）を求める。
  const sheetRect = sheet.getBoundingClientRect();
  const pageHeightDomPx = (sheet.scrollWidth * pageHeightMm) / pageWidthMm;
  const breakYs = Array.from(sheet.querySelectorAll("tr, [data-pagebreak]"))
    .map((el) => el.getBoundingClientRect().bottom - sheetRect.top)
    .filter((y) => y > 0 && y < sheet.scrollHeight)
    .sort((a, b) => a - b);

  // 強制改ページ（[data-force-break]）の上端。ここを跨がず、直前で必ずページを切る。
  const forceYs = Array.from(sheet.querySelectorAll("[data-force-break]"))
    .map((el) => el.getBoundingClientRect().top - sheetRect.top)
    .filter((y) => y > 0 && y < sheet.scrollHeight)
    .sort((a, b) => a - b);

  // ページ区間を決める（最低45%は埋める。ただし強制改ページは優先し短いページも許す）。
  const segments: [number, number][] = [];
  const minSegment = pageHeightDomPx * 0.45;
  let start = 0;
  while (start < sheet.scrollHeight - 1) {
    const idealEnd = start + pageHeightDomPx;
    const forcedBefore = forceYs.filter((y) => y > start + 1 && y <= idealEnd);
    let end: number;
    if (forcedBefore.length > 0) {
      // 強制改ページの直前で切る（最も手前のものを採用）。
      end = forcedBefore[0];
    } else if (idealEnd >= sheet.scrollHeight) {
      segments.push([start, sheet.scrollHeight]);
      break;
    } else {
      const candidates = breakYs.filter((y) => y > start + minSegment && y <= idealEnd);
      end = candidates.length > 0 ? candidates[candidates.length - 1] : idealEnd;
    }
    segments.push([start, end]);
    start = end;
  }

  const pdf = new jsPDF("p", "mm", "a4");
  const domToCanvas = canvas.height / sheet.scrollHeight;

  segments.forEach(([s, e], index) => {
    const startPx = Math.floor(s * domToCanvas);
    const endPx = Math.ceil(e * domToCanvas);
    const segHeightPx = Math.max(1, endPx - startPx);

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = segHeightPx;
    const ctx = pageCanvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, startPx, canvas.width, segHeightPx, 0, 0, pageCanvas.width, segHeightPx);
    }
    const img = pageCanvas.toDataURL("image/jpeg", 0.8);
    const mmHeight = (segHeightPx * pageWidthMm) / canvas.width;
    if (index > 0) pdf.addPage();
    pdf.addImage(img, "JPEG", 0, 0, pageWidthMm, Math.min(mmHeight, pageHeightMm));
  });

  pdf.save(fileName);
}
