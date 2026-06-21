// シフト表の描画（jsPDF=ベクターPDF / Canvas=高精細PNG の共通ロジック）。
//   コンポーネント側でプリビルドした ShiftPdfData を、A4横の座標空間(pt)で1枚に収めて描く。
//   レンダラを抽象化し、PDFとPNGで同一レイアウト・同一見た目にする。
import type { jsPDF } from "jspdf";

export type ExCellCourse = { label: string; color: string; slotLabel?: string }; // color = "#rrggbb"
export type ExCell =
  | { kind: "off" } // 希望休
  | { kind: "designated"; bg?: string } // 指定休
  | { kind: "courses"; courses: ExCellCourse[]; plate: string; bg?: string };

export type DayChrome = { headBg: string; headColor: string; cellBg?: string };

export type ShiftPdfData = {
  title: string;
  dateLabels: string[];
  dayChrome: DayChrome[];
  rows: { name: string; cells: ExCell[] }[];
  offLabel: string; // "未割当"
  offRow: string[]; // 日付ごとの未割当ドライバー名（"、"連結済み）
};

type RGB = [number, number, number];
type Align = "left" | "center";
type Baseline = "middle" | "alphabetic";

/** PDF / Canvas 共通の描画プリミティブ。座標・寸法は pt（A4横=842x595）。 */
export interface ShiftRenderer {
  rect(x: number, y: number, w: number, h: number, fill: RGB | null, stroke: RGB | null, lineW: number): void;
  roundedRect(x: number, y: number, w: number, h: number, r: number, fill: RGB | null, stroke: RGB | null, lineW: number): void;
  text(str: string, x: number, y: number, sizePt: number, color: RGB, align: Align, baseline: Baseline): void;
}

// --- 設計上の寸法（px相当。最後に scale でページptへ写像）---
const DRIVER_COL = 150;
const DATE_COL = 120;
const HEADER_H = 28;
const PAD_V = 5;
const PAD_X = 6;
const COURSE_H = 28;
const COURSE_GAP = 3;
const PLATE_H = 15;
const CELL_GAP = 3;
const OFF_LINE_H = 13;
const OFF_MAX_LINES = 5;
const BASE_CONTENT_H = COURSE_H + CELL_GAP + PLATE_H;

const F_HEADER = 11;
const F_NAME = 12;
const F_COURSE = 11.5;
const F_PLATE = 9;
const F_OFF = 9;

const GRID: RGB = [226, 232, 240];

const isWide = (ch: string) => /[　-ヿ㐀-鿿＀-￯]/.test(ch);
function estWidth(text: string, fontPx: number): number {
  let w = 0;
  for (const ch of text) w += isWide(ch) ? fontPx : fontPx * 0.55;
  return w;
}
function fitText(text: string, maxW: number, fontPx: number): string {
  if (estWidth(text, fontPx) <= maxW) return text;
  let s = text;
  while (s.length && estWidth(s + "…", fontPx) > maxW) s = s.slice(0, -1);
  return s ? s + "…" : "";
}
function wrapText(text: string, maxW: number, fontPx: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (cur && estWidth(cur + ch, fontPx) > maxW) {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines - 1) break;
    } else {
      cur += ch;
    }
  }
  const consumed = lines.join("").length;
  let rest = cur + text.slice(consumed + cur.length);
  if (lines.length >= maxLines - 1 && estWidth(rest, fontPx) > maxW) rest = fitText(rest, maxW, fontPx);
  if (rest) lines.push(rest);
  return lines.length ? lines : [""];
}

function parseColor(str: string | undefined, fallback: RGB = [255, 255, 255]): RGB {
  if (!str) return fallback;
  const s = str.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const v = parseInt(n, 16);
    if (Number.isNaN(v)) return fallback;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    return [
      Math.round(255 * (1 - a) + r * a),
      Math.round(255 * (1 - a) + g * a),
      Math.round(255 * (1 - a) + b * a),
    ];
  }
  return fallback;
}
function mix(hex: string, alpha: number): RGB {
  const [r, g, b] = parseColor(hex, [148, 163, 184]);
  return [
    Math.round(255 * (1 - alpha) + r * alpha),
    Math.round(255 * (1 - alpha) + g * alpha),
    Math.round(255 * (1 - alpha) + b * alpha),
  ];
}

function cellContentHeight(cell: ExCell): number {
  if (cell.kind === "courses") {
    const n = Math.max(1, cell.courses.length);
    const stack = n * COURSE_H + (n - 1) * COURSE_GAP;
    return Math.max(BASE_CONTENT_H, stack + (cell.plate ? CELL_GAP + PLATE_H : 0));
  }
  return BASE_CONTENT_H;
}

/** A4横の座標空間で表を1枚に収めて描画（レンダラ非依存）。 */
export function drawShiftTable(r: ShiftRenderer, data: ShiftPdfData, pageW: number, pageH: number): void {
  const margin = 22;
  const titleSize = 13;
  const titleH = 22;
  const tableTop = margin + titleH;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin - tableTop;

  const N = data.dateLabels.length;
  const designW = DRIVER_COL + N * DATE_COL;

  const rowH = data.rows.map((row) => PAD_V * 2 + Math.max(...row.cells.map(cellContentHeight), BASE_CONTENT_H));
  const offInnerW = DATE_COL - PAD_X * 2;
  const offLines = data.offRow.map((names) => (names ? wrapText(names, offInnerW, F_OFF, OFF_MAX_LINES).length : 1));
  const offRowH = PAD_V * 2 + Math.max(1, ...offLines) * OFF_LINE_H;

  const designH = HEADER_H + rowH.reduce((a, b) => a + b, 0) + offRowH;
  const scale = Math.min(usableW / designW, usableH / designH);
  const S = (v: number) => v * scale;

  const tableX = margin + (usableW - designW * scale) / 2;
  const tableY = tableTop + (usableH - designH * scale) / 2;

  const colX: number[] = [0, DRIVER_COL];
  for (let j = 1; j <= N; j++) colX.push(colX[colX.length - 1] + DATE_COL);
  const px = (dx: number) => tableX + S(dx);
  const py = (dy: number) => tableY + S(dy);

  // タイトル
  r.text(data.title, margin, margin + titleSize, titleSize, [17, 24, 39], "left", "alphabetic");

  const cellRect = (cx: number, cy: number, cw: number, ch: number, fill: RGB) =>
    r.rect(px(cx), py(cy), S(cw), S(ch), fill, GRID, 0.4);

  // ヘッダ行
  let y = 0;
  cellRect(0, y, DRIVER_COL, HEADER_H, [249, 250, 251]);
  r.text("ドライバー", px(PAD_X), py(y + HEADER_H / 2), F_HEADER * scale, [107, 114, 128], "left", "middle");
  for (let j = 0; j < N; j++) {
    const ch = data.dayChrome[j] ?? { headBg: "#f9fafb", headColor: "#6b7280" };
    cellRect(colX[j + 1], y, DATE_COL, HEADER_H, parseColor(ch.headBg, [249, 250, 251]));
    const label = fitText(data.dateLabels[j], DATE_COL - PAD_X * 2, F_HEADER);
    r.text(label, px(colX[j + 1] + DATE_COL / 2), py(y + HEADER_H / 2), F_HEADER * scale, parseColor(ch.headColor, [107, 114, 128]), "center", "middle");
  }
  y += HEADER_H;

  // ドライバー行
  data.rows.forEach((row, ri) => {
    const h = rowH[ri];
    cellRect(0, y, DRIVER_COL, h, [255, 255, 255]);
    r.text(fitText(row.name, DRIVER_COL - PAD_X * 2, F_NAME), px(PAD_X), py(y + h / 2), F_NAME * scale, [17, 24, 39], "left", "middle");

    row.cells.forEach((cell, j) => {
      const cx = colX[j + 1];
      const chrome = data.dayChrome[j];
      const bg =
        cell.kind === "off"
          ? ([255, 251, 235] as RGB)
          : parseColor(("bg" in cell ? cell.bg : undefined) ?? chrome?.cellBg, [255, 255, 255]);
      cellRect(cx, y, DATE_COL, h, bg);

      if (cell.kind === "off") {
        r.text("希望休", px(cx + DATE_COL / 2), py(y + h / 2), F_COURSE * scale, [146, 64, 14], "center", "middle");
        return;
      }
      if (cell.kind === "designated") {
        r.text("指定休", px(cx + DATE_COL / 2), py(y + h / 2), F_COURSE * scale, [148, 163, 184], "center", "middle");
        return;
      }
      const content = cellContentHeight(cell);
      let by = y + (h - content) / 2;
      const innerW = DATE_COL - PAD_X * 2;
      cell.courses.forEach((c) => {
        r.roundedRect(px(cx + PAD_X), py(by), S(innerW), S(COURSE_H), S(5), mix(c.color, 0.44), mix(c.color, 0.72), Math.max(0.5, S(1.5)));
        // 時間帯（時刻 or 便名）があれば「コース｜時間帯」を1行に収める（セル高は不変）。
        const courseText = c.slotLabel ? `${c.label}｜${c.slotLabel}` : c.label;
        r.text(fitText(courseText, innerW - PAD_X, F_COURSE), px(cx + DATE_COL / 2), py(by + COURSE_H / 2), F_COURSE * scale, [15, 23, 42], "center", "middle");
        by += COURSE_H + COURSE_GAP;
      });
      if (cell.plate) {
        by += -COURSE_GAP + CELL_GAP;
        r.text(fitText(cell.plate, innerW, F_PLATE), px(cx + DATE_COL / 2), py(by + PLATE_H / 2), F_PLATE * scale, [71, 85, 105], "center", "middle");
      }
    });
    y += h;
  });

  // 未割当行
  cellRect(0, y, DRIVER_COL, offRowH, [249, 250, 251]);
  r.text(data.offLabel, px(PAD_X), py(y + offRowH / 2), F_NAME * scale, [75, 85, 99], "left", "middle");
  for (let j = 0; j < N; j++) {
    const cx = colX[j + 1];
    cellRect(cx, y, DATE_COL, offRowH, parseColor(data.dayChrome[j]?.cellBg, [255, 255, 255]));
    const names = data.offRow[j] ?? "";
    if (!names) continue;
    const lines = wrapText(names, offInnerW, F_OFF, OFF_MAX_LINES);
    const totalH = lines.length * OFF_LINE_H;
    let ly = y + (offRowH - totalH) / 2 + OFF_LINE_H / 2;
    for (const line of lines) {
      r.text(line, px(cx + DATE_COL / 2), py(ly), F_OFF * scale, [100, 116, 139], "center", "middle");
      ly += OFF_LINE_H;
    }
  }
}

// === jsPDF アダプタ ===
function jsPdfRenderer(pdf: jsPDF, fontName: string): ShiftRenderer {
  pdf.setFont(fontName, "normal");
  return {
    rect(x, y, w, h, fill, stroke, lineW) {
      if (fill) pdf.setFillColor(fill[0], fill[1], fill[2]);
      if (stroke) {
        pdf.setDrawColor(stroke[0], stroke[1], stroke[2]);
        pdf.setLineWidth(lineW);
      }
      pdf.rect(x, y, w, h, fill && stroke ? "FD" : fill ? "F" : "S");
    },
    roundedRect(x, y, w, h, rad, fill, stroke, lineW) {
      if (fill) pdf.setFillColor(fill[0], fill[1], fill[2]);
      if (stroke) {
        pdf.setDrawColor(stroke[0], stroke[1], stroke[2]);
        pdf.setLineWidth(lineW);
      }
      pdf.roundedRect(x, y, w, h, rad, rad, fill && stroke ? "FD" : fill ? "F" : "S");
    },
    text(str, x, y, sizePt, color, align, baseline) {
      pdf.setTextColor(color[0], color[1], color[2]);
      pdf.setFontSize(sizePt);
      pdf.text(str, x, y, { align, baseline });
    },
  };
}

/** ベクターPDF（jsPDF）に描画。fontName は登録済み日本語フォント名。 */
export function drawShiftPdf(pdf: jsPDF, data: ShiftPdfData, fontName: string): void {
  drawShiftTable(jsPdfRenderer(pdf, fontName), data, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
}

// === Canvas アダプタ（PNG用）===
const rgbCss = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
function canvasRenderer(ctx: CanvasRenderingContext2D, fontFamily: string): ShiftRenderer {
  return {
    rect(x, y, w, h, fill, stroke, lineW) {
      if (fill) {
        ctx.fillStyle = rgbCss(fill);
        ctx.fillRect(x, y, w, h);
      }
      if (stroke) {
        ctx.strokeStyle = rgbCss(stroke);
        ctx.lineWidth = lineW;
        ctx.strokeRect(x, y, w, h);
      }
    },
    roundedRect(x, y, w, h, rad, fill, stroke, lineW) {
      ctx.beginPath();
      const r = Math.min(rad, w / 2, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = rgbCss(fill);
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = rgbCss(stroke);
        ctx.lineWidth = lineW;
        ctx.stroke();
      }
    },
    text(str, x, y, sizePt, color, align, baseline) {
      ctx.fillStyle = rgbCss(color);
      ctx.font = `${sizePt}px ${fontFamily}`;
      ctx.textAlign = align;
      ctx.textBaseline = baseline === "middle" ? "middle" : "alphabetic";
      ctx.fillText(str, x, y);
    },
  };
}

/** PDFと同一レイアウトで高精細PNGを描く Canvas を返す。フォントは PDF と同じものを読み込む。 */
export async function renderShiftCanvas(data: ShiftPdfData): Promise<HTMLCanvasElement> {
  const pageW = 842;
  const pageH = 595; // A4横(pt) — PDFと同じ比率
  const dpr = 3; // 高精細化
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pageW * dpr);
  canvas.height = Math.round(pageH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageW, pageH);

  // PDFと同じフォントを Canvas にも読み込む（見た目を一致させる）。失敗時は既定フォントで描画。
  let family = "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif";
  try {
    const face = new FontFace("ShiftJP", "url(/fonts/SawarabiGothic-Regular.ttf)");
    await face.load();
    (document as Document & { fonts: FontFaceSet }).fonts.add(face);
    family = "ShiftJP, " + family;
  } catch {
    // フォント読み込み失敗時はシステムフォントで続行。
  }

  drawShiftTable(canvasRenderer(ctx, family), data, pageW, pageH);
  return canvas;
}
