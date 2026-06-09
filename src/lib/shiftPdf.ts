// シフト表のベクターPDF描画（jsPDF）。
//   コンポーネント側でプリビルドした ShiftPdfData を受け取り、A4横1ページに収めて描く。
//   画像化(html2canvas)を介さないので軽量・くっきり・文字選択可。日本語は登録済みフォント前提。
import type { jsPDF } from "jspdf";

export type ExCellCourse = { label: string; color: string }; // color = "#rrggbb"
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
const BASE_CONTENT_H = COURSE_H + CELL_GAP + PLATE_H; // 1コース＋ナンバー相当（行の最小高）

// フォントサイズ（px相当）
const F_HEADER = 11;
const F_NAME = 12;
const F_COURSE = 11.5;
const F_PLATE = 9;
const F_OFF = 9;

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
  // 残り（最終行）。溢れる場合は省略記号で詰める。
  const consumed = lines.join("").length;
  let rest = cur + text.slice(consumed + cur.length);
  if (lines.length >= maxLines - 1 && estWidth(rest, fontPx) > maxW) rest = fitText(rest, maxW, fontPx);
  if (rest) lines.push(rest);
  return lines.length ? lines : [""];
}

type RGB = [number, number, number];
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
    // 白の上に alpha 合成。
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

/** ShiftPdfData を pdf に1ページで描画する。fontName は登録済み日本語フォント名。 */
export function drawShiftPdf(pdf: jsPDF, data: ShiftPdfData, fontName: string): void {
  pdf.setFont(fontName, "normal");
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 22;
  const titleSize = 13;
  const titleH = 22;
  const tableTop = margin + titleH;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin - tableTop;

  const N = data.dateLabels.length;
  const designW = DRIVER_COL + N * DATE_COL;

  // 行の高さ（設計px）。
  const rowH = data.rows.map((row) => PAD_V * 2 + Math.max(...row.cells.map(cellContentHeight), BASE_CONTENT_H));
  // 未割当行の高さ（名前を date 幅で折り返した行数から）。
  const offInnerW = DATE_COL - PAD_X * 2;
  const offLines = data.offRow.map((names) => (names ? wrapText(names, offInnerW, F_OFF, OFF_MAX_LINES).length : 1));
  const offRowH = PAD_V * 2 + Math.max(1, ...offLines) * OFF_LINE_H;

  const designH = HEADER_H + rowH.reduce((a, b) => a + b, 0) + offRowH;
  const scale = Math.min(usableW / designW, usableH / designH);
  const S = (v: number) => v * scale;

  const tableX = margin + (usableW - designW * scale) / 2;
  const tableY = tableTop + (usableH - designH * scale) / 2;

  // 列のX（設計px起点）。
  const colX: number[] = [0];
  colX.push(DRIVER_COL);
  for (let j = 1; j <= N; j++) colX.push(colX[colX.length - 1] + DATE_COL);
  const colWDesign = (j: number) => (j === 0 ? DRIVER_COL : DATE_COL);

  const px = (dx: number) => tableX + S(dx);
  const py = (dy: number) => tableY + S(dy);

  // タイトル。
  pdf.setTextColor(17, 24, 39);
  pdf.setFontSize(titleSize);
  pdf.text(data.title, margin, margin + titleSize);

  // --- ヘッダ行 ---
  let y = 0;
  const drawCellRect = (cx: number, cy: number, cw: number, ch: number, fill: RGB) => {
    pdf.setFillColor(fill[0], fill[1], fill[2]);
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.4);
    pdf.rect(px(cx), py(cy), S(cw), S(ch), "FD");
  };

  // ドライバー見出し
  drawCellRect(0, y, DRIVER_COL, HEADER_H, [249, 250, 251]);
  pdf.setTextColor(107, 114, 128);
  pdf.setFontSize(F_HEADER * scale);
  pdf.text("ドライバー", px(PAD_X), py(y + HEADER_H / 2), { baseline: "middle" });
  // 日付見出し
  for (let j = 0; j < N; j++) {
    const ch = data.dayChrome[j] ?? { headBg: "#f9fafb", headColor: "#6b7280" };
    drawCellRect(colX[j + 1], y, DATE_COL, HEADER_H, parseColor(ch.headBg, [249, 250, 251]));
    const hc = parseColor(ch.headColor, [107, 114, 128]);
    pdf.setTextColor(hc[0], hc[1], hc[2]);
    pdf.setFontSize(F_HEADER * scale);
    const label = fitText(data.dateLabels[j], DATE_COL - PAD_X * 2, F_HEADER);
    pdf.text(label, px(colX[j + 1] + DATE_COL / 2), py(y + HEADER_H / 2), { align: "center", baseline: "middle" });
  }
  y += HEADER_H;

  // --- ドライバー行 ---
  data.rows.forEach((row, ri) => {
    const h = rowH[ri];
    // 名前セル
    drawCellRect(0, y, DRIVER_COL, h, [255, 255, 255]);
    pdf.setTextColor(17, 24, 39);
    pdf.setFontSize(F_NAME * scale);
    pdf.text(fitText(row.name, DRIVER_COL - PAD_X * 2, F_NAME), px(PAD_X), py(y + h / 2), { baseline: "middle" });

    row.cells.forEach((cell, j) => {
      const cx = colX[j + 1];
      const chrome = data.dayChrome[j];
      const bg =
        cell.kind === "off"
          ? ([255, 251, 235] as RGB)
          : parseColor(("bg" in cell ? cell.bg : undefined) ?? chrome?.cellBg, [255, 255, 255]);
      drawCellRect(cx, y, DATE_COL, h, bg);

      if (cell.kind === "off") {
        pdf.setTextColor(146, 64, 14);
        pdf.setFontSize(F_COURSE * scale);
        pdf.text("希望休", px(cx + DATE_COL / 2), py(y + h / 2), { align: "center", baseline: "middle" });
        return;
      }
      if (cell.kind === "designated") {
        pdf.setTextColor(148, 163, 184);
        pdf.setFontSize(F_COURSE * scale);
        pdf.text("指定休", px(cx + DATE_COL / 2), py(y + h / 2), { align: "center", baseline: "middle" });
        return;
      }
      // courses
      const content = cellContentHeight(cell);
      let by = y + (h - content) / 2; // セル内で縦中央寄せ
      const innerW = DATE_COL - PAD_X * 2;
      cell.courses.forEach((c) => {
        const fill = mix(c.color, 0.44);
        const stroke = mix(c.color, 0.72);
        pdf.setFillColor(fill[0], fill[1], fill[2]);
        pdf.setDrawColor(stroke[0], stroke[1], stroke[2]);
        pdf.setLineWidth(Math.max(0.5, S(1.5)));
        pdf.roundedRect(px(cx + PAD_X), py(by), S(innerW), S(COURSE_H), S(5), S(5), "FD");
        pdf.setTextColor(15, 23, 42);
        pdf.setFontSize(F_COURSE * scale);
        pdf.text(fitText(c.label, innerW - PAD_X, F_COURSE), px(cx + DATE_COL / 2), py(by + COURSE_H / 2), {
          align: "center",
          baseline: "middle",
        });
        by += COURSE_H + COURSE_GAP;
      });
      if (cell.plate) {
        by += -COURSE_GAP + CELL_GAP;
        pdf.setTextColor(71, 85, 105);
        pdf.setFontSize(F_PLATE * scale);
        pdf.text(fitText(cell.plate, innerW, F_PLATE), px(cx + DATE_COL / 2), py(by + PLATE_H / 2), {
          align: "center",
          baseline: "middle",
        });
      }
    });
    y += h;
  });

  // --- 未割当行 ---
  drawCellRect(0, y, DRIVER_COL, offRowH, [249, 250, 251]);
  pdf.setTextColor(75, 85, 99);
  pdf.setFontSize(F_NAME * scale);
  pdf.text(data.offLabel, px(PAD_X), py(y + offRowH / 2), { baseline: "middle" });
  for (let j = 0; j < N; j++) {
    const cx = colX[j + 1];
    const chrome = data.dayChrome[j];
    drawCellRect(cx, y, DATE_COL, offRowH, parseColor(chrome?.cellBg, [255, 255, 255]));
    const names = data.offRow[j] ?? "";
    if (!names) continue;
    const lines = wrapText(names, offInnerW, F_OFF, OFF_MAX_LINES);
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(F_OFF * scale);
    const totalH = lines.length * OFF_LINE_H;
    let ly = y + (offRowH - totalH) / 2 + OFF_LINE_H / 2;
    for (const line of lines) {
      pdf.text(line, px(cx + DATE_COL / 2), py(ly), { align: "center", baseline: "middle" });
      ly += OFF_LINE_H;
    }
  }
}
