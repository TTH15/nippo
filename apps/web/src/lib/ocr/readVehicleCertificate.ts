import { certificateTextFromWords, parseVehicleCertificate, type VehicleCertificateDraft } from "./vehicleCertificate";

export type CertificateReadResult = { draft: VehicleCertificateDraft; preview: string; pages: number };
export class CertificateReadError extends Error {}
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("中止しました", "AbortError"); };
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("中止しました", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** 読取中だけ写真をメモリに置く。API・Storage・外部OCRサービスへ送信しない。 */
export async function readVehicleCertificate(file: File, options: { signal: AbortSignal; onProgress: (progress: number) => void }): Promise<CertificateReadResult> {
  const { signal, onProgress } = options;
  if (file.size > 15 * 1024 * 1024) throw new CertificateReadError("写真を撮り直すか、車検証のページだけを選んでください。");
  const pdfFile = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!pdfFile && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new CertificateReadError("JPEG・PNG・WebPの写真かPDFを選んでください。");
  checkAbort(signal); onProgress(0);
  const canvas = document.createElement("canvas");
  let text = "", pages = 1;
  let worker: import("tesseract.js").Worker | undefined;
  try {
    if (pdfFile) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      checkAbort(signal);
      pdfjs.GlobalWorkerOptions.workerSrc = "/ocr/runtime/pdf/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({
        data: await file.arrayBuffer(), useSystemFonts: true,
        cMapUrl: "/ocr/runtime/pdf/cmaps/", cMapPacked: true,
        standardFontDataUrl: "/ocr/runtime/pdf/standard_fonts/", wasmUrl: "/ocr/runtime/pdf/wasm/",
      });
      const abortPdf = () => { void task.destroy(); };
      signal.addEventListener("abort", abortPdf, { once: true });
      try {
        const pdf = await abortable(task.promise, signal); pages = pdf.numPages;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) });
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await abortable(page.render({ canvas, viewport }).promise, signal);
        const content = await page.getTextContent();
        text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      } finally { signal.removeEventListener("abort", abortPdf); await task.destroy(); }
    } else {
      const bitmap = await abortable(createImageBitmap(file).then(bitmap => { if (signal.aborted) { bitmap.close(); checkAbort(signal); } return bitmap; }), signal);
      try {
        if (bitmap.width * bitmap.height > 50_000_000) throw new CertificateReadError("写真を撮り直して、もう一度選んでください。");
        const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally { bitmap.close(); }
    }
    checkAbort(signal);
    const draft = parseVehicleCertificate(text);
    // 文字PDFでも帳票の順番が崩れたり、画像部分に番号がある場合はOCRで未読欄を補う。
    if (!draft.modelCode || !draft.numberNumeric) {
      const { createWorker, PSM } = await import("tesseract.js");
      const ready = createWorker(["jpn", "eng"], 1, {
        workerPath: "/ocr/runtime/tesseract/worker.min.js", corePath: "/ocr/runtime/tesseract",
        langPath: "/ocr/lang", gzip: false, workerBlobURL: false, cachePath: "hakotora-vehicle-fast-20260914",
        logger: m => { if (!signal.aborted && m.status === "recognizing text") onProgress(Math.round(m.progress * 100)); },
      }).then(async w => { if (signal.aborted) { await w.terminate(); checkAbort(signal); } return w; });
      worker = await abortable(ready, signal);
      checkAbort(signal);
      // 独立した欄を読み、Canvasで失われる解像度情報を固定する。
      // 自動推定に任せると、罫線付きの写真で欄内の文字を認識対象から落とす。
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "300" });
      const result = await abortable(worker.recognize(canvas, {}, { blocks: true }), signal);
      const words = result.data.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
      const scanned = parseVehicleCertificate(certificateTextFromWords(words));
      const plain = parseVehicleCertificate(result.data.text);
      for (const key of Object.keys(draft) as (keyof VehicleCertificateDraft)[]) {
        if (!draft[key]) draft[key] = scanned[key] || plain[key];
      }
    }
    checkAbort(signal); onProgress(100);
    return { draft, preview: canvas.toDataURL("image/jpeg", 0.9), pages };
  } finally { await worker?.terminate(); canvas.width = 0; canvas.height = 0; }
}
