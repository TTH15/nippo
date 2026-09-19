import { renderPlateImage } from "./plateImage";
import { captureScale } from "./imageCaptureScale";
import type { VehiclePlateData } from "./components/VehiclePlate";

export type ShiftImage = { blob: Blob; url: string; width: number; height: number };

/**
 * 画面に出している出力盤面を複製し、CSS mask で描いているナンバープレートだけを
 * 同じ配置の画像へ差し替えてから html2canvas にかける（日別配車の画像化と同じ手順）。
 *
 * ここは「見えているものをそのまま画像にする」ため、レイアウトは source 側が正。
 */
export async function captureShiftImage(source: HTMLElement): Promise<ShiftImage> {
  await document.fonts.ready;
  const width = Math.max(source.scrollWidth, source.offsetWidth);
  const stage = document.createElement("div");
  const fontMetricsStyle = document.createElement("style");
  // html2canvas 1.4 は元 document へ 1px 画像を置いてベースラインを測る。
  // Tailwind の img { display: block } が計測を崩すため、計測用の画像だけ inline に戻す。
  fontMetricsStyle.textContent =
    'body > div[style*="visibility: hidden"] > img[width="1"][height="1"] { display: inline-block; }';
  stage.inert = true;
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, {
    position: "fixed", left: "-10000px", top: "0", width: `${width}px`,
    background: "#ffffff", boxSizing: "border-box",
  });
  try {
    const board = source.cloneNode(true) as HTMLElement;
    board.removeAttribute("aria-hidden");
    board.removeAttribute("inert");
    board.querySelectorAll("[data-export-omit]").forEach((element) => element.remove());
    stage.append(board);
    document.body.append(stage);

    await Promise.all(
      [...board.querySelectorAll<HTMLElement>("[data-export-plate='true']")].map(async (slot) => {
        const inner = slot.querySelector<HTMLElement>('div[style*="aspect-ratio"]');
        if (!inner) return;
        const data = slot.dataset;
        const vehicle: VehiclePlateData = {
          id: data.exportPlateId ?? "export",
          plate_color: (data.exportPlateColor ?? "black") as VehiclePlateData["plate_color"],
          number_prefix: data.exportPlateRegion,
          number_class: data.exportPlateClass,
          number_hiragana: data.exportPlateKana,
          number_numeric: data.exportPlateNumber,
        };
        const plate = await renderPlateImage(vehicle, inner.getBoundingClientRect().width || 120);
        const image = new Image();
        image.src = plate.canvas.toDataURL("image/png");
        await image.decode();
        // 影は絶対配置で外へ広げ、プレート本体の大きさと文字間隔を変えない。
        Object.assign(inner.style, {
          position: "relative", height: `${plate.height}px`, overflow: "visible",
          border: "none", boxShadow: "none", background: "transparent",
        });
        Object.assign(image.style, {
          position: "absolute", maxWidth: "none",
          left: `${-plate.padding}px`, top: `${-plate.padding}px`,
          width: `${plate.width + plate.padding * 2}px`, height: `${plate.height + plate.padding * 2}px`,
        });
        inner.replaceChildren(image);
      }),
    );

    const { default: html2canvas } = await import("html2canvas");
    document.head.append(fontMetricsStyle);
    const height = stage.scrollHeight;
    // 枚数で割らず1枚に収めるので、キャンバスの上限に当たらない倍率を選ぶ。
    const scale = captureScale(width, height);
    const canvas = await html2canvas(stage, {
      backgroundColor: "#ffffff", scale, logging: false,
      width, height, windowWidth: width, scrollX: 0, scrollY: 0,
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("画像を作成できませんでした");
    return { blob, url: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally {
    fontMetricsStyle.remove();
    stage.remove();
  }
}
