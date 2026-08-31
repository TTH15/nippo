import { renderPlateImage } from "./plateImage";
import type { VehiclePlateData } from "./components/VehiclePlate";

export const DISPATCH_IMAGE_PAGE_SIZE = 10;
export type DispatchImage = { blob: Blob; url: string; width: number; height: number };

/** 実際の日別一覧を複製し、CSS maskだけ同じSVG・配置で描画した画像へ差し替える。 */
export async function captureDispatchImage(source: HTMLElement, options: {
  title: string; subtitle: string; page: number; pageCount: number;
}): Promise<DispatchImage> {
  await document.fonts.ready;
  const width = 408;
  const stage = document.createElement("div");
  const fontMetricsStyle = document.createElement("style");
  // html2canvas 1.4は元documentへ1px画像を置いてベースラインを測る。
  // Tailwindのimg { display: block }が計測を崩すため、非表示の計測画像だけをinlineへ戻す。
  // onclone内では元documentの計測を直せない。画面・プレート画像には適用しない。
  fontMetricsStyle.textContent = 'body > div[style*="visibility: hidden"] > img[width="1"][height="1"] { display: inline-block; }';
  stage.inert = true;
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, { position: "fixed", left: "-10000px", top: "0", width: `${width}px`, padding: "12px", background: "#f8fafc", boxSizing: "border-box" });
  try {
    const header = document.createElement("div");
    Object.assign(header.style, { color: "#0f172a", fontSize: "16px", fontWeight: "700", padding: "4px 0 12px" });
    header.textContent = options.title;
    const subtitle = document.createElement("div");
    subtitle.textContent = `${options.subtitle}${options.pageCount > 1 ? ` · ${options.page + 1}/${options.pageCount}枚目` : ""}`;
    Object.assign(subtitle.style, { color: "#64748b", fontSize: "12px", paddingBottom: "12px" });
    const list = source.cloneNode(true) as HTMLElement;
    list.removeAttribute("aria-hidden"); list.removeAttribute("inert");
    list.className = "";
    list.querySelectorAll<HTMLElement>("[data-export-row]").forEach((row, index) => {
      if (index < options.page * DISPATCH_IMAGE_PAGE_SIZE || index >= (options.page + 1) * DISPATCH_IMAGE_PAGE_SIZE) row.remove();
    });
    list.querySelectorAll("[data-export-omit]").forEach(element => element.remove());
    list.querySelectorAll("[data-export-section]").forEach(element => { if (!element.querySelector("[data-export-row]")) element.remove(); });
    list.querySelectorAll<HTMLElement>("[data-mobile-export-course-color]").forEach(chip => {
      // inset shadow非対応のため、行内寸法を保った枠線にする。
      const color = chip.dataset.mobileExportCourseColor ?? "#94a3b8";
      chip.style.boxShadow = "none";
      chip.style.outline = `2px solid ${color}`;
      chip.style.outlineOffset = "-2px";
    });
    stage.append(header, subtitle, list);
    document.body.append(stage);
    await Promise.all([...list.querySelectorAll<HTMLElement>("[data-mobile-export-plate='true']")].map(async slot => {
      const inner = slot.querySelector<HTMLElement>('div[style*="aspect-ratio"]');
      // 番号未登録車の車種名表示は、そのまま取り込む。
      if (!inner) return;
      const data = slot.dataset;
      const vehicle: VehiclePlateData = {
        id: data.mobileExportPlateId ?? "export",
        plate_color: (data.mobileExportPlateColor ?? "black") as VehiclePlateData["plate_color"],
        number_prefix: data.mobileExportPlateRegion,
        number_class: data.mobileExportPlateClass,
        number_hiragana: data.mobileExportPlateKana,
        number_numeric: data.mobileExportPlateNumber,
      };
      const plate = await renderPlateImage(vehicle, inner.getBoundingClientRect().width || 88);
      // 影の領域は絶対配置で外へ広げ、元のプレートの大きさや文字間隔を変えない。
      const image = new Image();
      image.src = plate.canvas.toDataURL("image/png");
      await image.decode();
      // 外側のオイル交換警告・使用不可バッジは消さず、プレート面だけ置き換える。
      Object.assign(inner.style, { position: "relative", height: `${plate.height}px`, overflow: "visible", border: "none", boxShadow: "none", background: "transparent" });
      Object.assign(image.style, { position: "absolute", maxWidth: "none", left: `${-plate.padding}px`, top: `${-plate.padding}px`, width: `${plate.width + plate.padding * 2}px`, height: `${plate.height + plate.padding * 2}px` });
      inner.replaceChildren(image);
    }));
    const { default: html2canvas } = await import("html2canvas");
    document.head.append(fontMetricsStyle);
    const canvas = await html2canvas(stage, { backgroundColor: "#f8fafc", scale: 3, logging: false, width, height: stage.scrollHeight, windowWidth: width, scrollX: 0, scrollY: 0 });
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("画像を作成できませんでした");
    // 実体PNGのdata URL。共有シートを開いている間にURLが失効することはない。
    return { blob, url: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally { fontMetricsStyle.remove(); stage.remove(); }
}
