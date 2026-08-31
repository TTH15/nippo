import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { VehiclePlate, type VehiclePlateData } from "@/lib/components/VehiclePlate";

const DENSITY = 3;
const PLATE_WIDTH = 100; // 日別一覧の112pxセル内、左右6pxの余白を除いた幅。
const SHADOW_PADDING = 16;
export type PlateImage = { canvas: HTMLCanvasElement; width: number; height: number; padding: number };
const images = new Map<string, Promise<HTMLImageElement>>();
function loadGlyph(src: string): Promise<HTMLImageElement> {
  const cached = images.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => reject(new Error("プレート素材の読み込みがタイムアウトしました")), 10000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error("プレート素材を読み込めませんでした")); };
    // CSS maskと同じローカルSVGを使用。API・外部画像へのアクセスは行わない。
    image.src = src;
  });
  images.set(src, promise);
  promise.catch(() => images.delete(src));
  return promise;
}

/** 実際のVehiclePlateを同じ幅で配置し、CSS適用後の座標を取得する。文字配置は複製しない。 */
function measurePlate(vehicle: VehiclePlateData, width: number) {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true"); host.inert = true;
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", width: `${width}px`, pointerEvents: "none" });
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(VehiclePlate, { vehicle, compact: true, className: "w-full" })));
    const plate = host.querySelector<HTMLElement>('[style*="aspect-ratio"]');
    if (!plate) throw new Error("プレートの表示を取得できませんでした");
    const bounds = plate.getBoundingClientRect();
    const style = getComputedStyle(plate);
    const items = [...plate.querySelectorAll<HTMLElement>("span, div")].map(element => {
      const rect = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      let filter = css.filter;
      for (let parent = element.parentElement; filter === "none" && parent && parent !== plate; parent = parent.parentElement) filter = getComputedStyle(parent).filter;
      return { x: rect.x - bounds.x, y: rect.y - bounds.y, width: rect.width, height: rect.height,
        visible: css.visibility !== "hidden", src: /^url\(["']?(.*?)["']?\)$/.exec(css.maskImage)?.[1],
        maskSize: css.maskSize.split(" ").map(parseFloat), maskPosition: css.maskPosition.split(" ").map(parseFloat),
        color: css.backgroundColor, gradient: css.backgroundImage, filter,
        text: element.children.length ? "" : element.textContent || "", textColor: css.color,
        font: `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`, letterSpacing: css.letterSpacing,
      };
    });
    return { width: bounds.width, height: bounds.height, radius: parseFloat(style.borderRadius), border: parseFloat(style.borderTopWidth), frame: style.borderTopColor, background: style.backgroundColor, shadow: style.boxShadow, items };
  } finally {
    root.unmount(); host.remove();
  }
}

// ブラウザの計算済みCSSは色→長さの順。枠と数字の影も画面から引き継ぐ。
function parseShadow(value: string) {
  const color = value.match(/rgba?\([^)]+\)/)?.[0] || "transparent";
  const [x = 0, y = 0, blur = 0, spread = 0] = (value.replace(color, "").match(/-?[\d.]+px/g) || []).map(parseFloat);
  return { color, x, y, blur, spread, inset: value.includes("inset") };
}
function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * DENSITY); canvas.height = Math.ceil(height * DENSITY);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を描画できませんでした");
  context.scale(DENSITY, DENSITY);
  return { canvas, context };
}

/** SVGの字形と実画面の座標・余白・配色をCanvasへ写す。画像化ライブラリのCSS mask対応に依存しない。 */
export async function renderPlateImage(vehicle: VehiclePlateData, plateWidth = PLATE_WIDTH): Promise<PlateImage> {
  // Reactのeffect中から呼ばれても、別rootの同期レイアウトを安全に取得する。
  await document.fonts.ready;
  const plate = measurePlate(vehicle, plateWidth);
  const glyphs = plate.items.filter(item => item.visible && item.src);
  const sources = new Map(await Promise.all(glyphs.map(async item => [item.src!, await loadGlyph(item.src!)] as const)));
  const padding = SHADOW_PADDING;
  const width = plate.width + padding * 2, height = plate.height + padding * 2;
  const { canvas, context: ctx } = makeCanvas(width, height);
  ctx.translate(padding, padding);
  const path = (inset: number) => { ctx.beginPath(); ctx.roundRect(inset, inset, plate.width - inset * 2, plate.height - inset * 2, Math.max(0, plate.radius - inset)); };
  const shadows = plate.shadow.split(/,(?![^(]*\))/).map(parseShadow);
  for (const shadow of shadows.filter(item => !item.inset)) {
    ctx.save(); ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur * DENSITY;
    ctx.shadowOffsetX = shadow.x * DENSITY; ctx.shadowOffsetY = shadow.y * DENSITY;
    ctx.fillStyle = plate.background; path(0); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = plate.frame; path(0); ctx.fill();
  ctx.fillStyle = plate.background; path(plate.border); ctx.fill();
  for (const shadow of shadows.filter(item => item.inset)) {
    ctx.strokeStyle = shadow.color; ctx.lineWidth = shadow.spread;
    path(plate.border + shadow.spread / 2); ctx.stroke();
  }
  ctx.save(); path(plate.border); ctx.clip();
  for (const bolt of plate.items.filter(item => item.gradient.startsWith("radial-gradient"))) {
    const colors = bolt.gradient.match(/rgba?\([^)]+\)/g) || [];
    const gradient = ctx.createRadialGradient(bolt.x + bolt.width * .4, bolt.y + bolt.height * .4, 0, bolt.x + bolt.width * .4, bolt.y + bolt.height * .4, bolt.width * .85);
    [0, .6, 1].forEach((stop, i) => gradient.addColorStop(stop, colors[i] || "#222"));
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.ellipse(bolt.x + bolt.width / 2, bolt.y + bolt.height / 2, bolt.width / 2, bolt.height / 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 同じfilterのグリフを1枚にまとめ、数字全体へ画面と同じdrop-shadowをかける。
  for (const filter of new Set(glyphs.map(item => item.filter))) {
    const layer = makeCanvas(width, height);
    layer.context.translate(padding, padding);
    for (const item of glyphs.filter(item => item.filter === filter)) {
      const tile = makeCanvas(item.width, item.height);
      const [maskW, maskH = maskW] = item.maskSize;
      tile.context.drawImage(sources.get(item.src!)!, item.maskPosition[0], item.maskPosition[1], maskW, maskH);
      tile.context.globalCompositeOperation = "source-in"; tile.context.fillStyle = item.color;
      tile.context.fillRect(0, 0, item.width, item.height);
      layer.context.drawImage(tile.canvas, item.x, item.y, tile.canvas.width / DENSITY, tile.canvas.height / DENSITY);
    }
    ctx.save();
    if (filter.startsWith("drop-shadow")) {
      const shadow = parseShadow(filter);
      ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur * 2 * DENSITY;
      ctx.shadowOffsetX = shadow.x * DENSITY; ctx.shadowOffsetY = shadow.y * DENSITY;
    }
    ctx.drawImage(layer.canvas, -padding, -padding, width, height); ctx.restore();
  }
  // 未収録の文字だけ、画面が使用したフォント・サイズ・位置で描画する。
  for (const item of plate.items.filter(item => item.visible && item.text && !item.src)) {
    ctx.font = item.font; ctx.fillStyle = item.textColor; ctx.textBaseline = "middle";
    ctx.letterSpacing = item.letterSpacing === "normal" ? "0px" : item.letterSpacing;
    ctx.fillText(item.text, item.x, item.y + item.height / 2);
  }
  ctx.restore();
  return { canvas, width: plate.width, height: plate.height, padding };
}
