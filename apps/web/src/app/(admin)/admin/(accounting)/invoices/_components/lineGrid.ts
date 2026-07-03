import { type EditorLine, emptyLine } from "./editorModel";

// 明細テーブルのスプレッドシート的編集の純粋ロジック。
// UI（選択・ドラッグ状態）は InvoiceSheet 側、ここは EditorLine[] の不変変換のみ。

/** 編集可能な列の並び（税抜合計は計算列なので含めない）。 */
export const EDIT_COLS = ["title", "qty", "unit", "price"] as const;
export type EditCol = (typeof EDIT_COLS)[number];
export const COL_COUNT = EDIT_COLS.length;

/** 数値列は記号・カンマ・全角空白を除いて素の値に寄せる（計算は描画時に解釈）。 */
function sanitizeForCol(key: EditCol, v: string): string {
  const s = String(v ?? "");
  if (key === "qty" || key === "price") {
    return s.replace(/[,，\s　¥￥]/g, "").trim();
  }
  return s.trim();
}

/** クリップボードのテキスト → 2次元配列（TSV: 行=改行 / 列=タブ）。 */
export function parseClipboardGrid(text: string): string[][] {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/, "");
  if (normalized === "") return [];
  return normalized.split("\n").map((row) => row.split("\t"));
}

/** start(row,col) を起点に matrix を流し込む。不足行は追加。列は EDIT_COLS にクランプ。 */
export function applyPaste(
  lines: EditorLine[],
  startRow: number,
  startCol: number,
  matrix: string[][],
): EditorLine[] {
  if (matrix.length === 0) return lines;
  const next = lines.map((l) => ({ ...l }));
  for (let r = 0; r < matrix.length; r++) {
    const targetRow = startRow + r;
    while (next.length <= targetRow) next.push(emptyLine());
    const cells = matrix[r];
    for (let c = 0; c < cells.length; c++) {
      const colIdx = startCol + c;
      if (colIdx < 0 || colIdx >= COL_COUNT) continue;
      const key = EDIT_COLS[colIdx];
      next[targetRow][key] = sanitizeForCol(key, cells[c]);
    }
  }
  return next;
}

/** fromRow の値を toRow までの同一列にコピー（フィルハンドル）。 */
export function fillColumn(
  lines: EditorLine[],
  col: number,
  fromRow: number,
  toRow: number,
): EditorLine[] {
  const key = EDIT_COLS[col];
  if (!key) return lines;
  const lo = Math.min(fromRow, toRow);
  const hi = Math.max(fromRow, toRow);
  const val = lines[fromRow]?.[key] ?? "";
  return lines.map((l, i) => (i >= lo && i <= hi ? { ...l, [key]: val } : l));
}

/** index の位置に空行を挿入。 */
export function insertLineAt(lines: EditorLine[], index: number): EditorLine[] {
  const next = lines.map((l) => ({ ...l }));
  const at = Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, emptyLine());
  return next;
}

/** index の行を削除。0行になってもよい（表自体は残る）。 */
export function removeLineAt(lines: EditorLine[], index: number): EditorLine[] {
  return lines.filter((_, i) => i !== index);
}

/** from → to へ行を移動（並べ替え）。 */
export function moveLine(lines: EditorLine[], from: number, to: number): EditorLine[] {
  if (from === to || from < 0 || from >= lines.length) return lines;
  const next = lines.map((l) => ({ ...l }));
  const [moved] = next.splice(from, 1);
  const dest = Math.max(0, Math.min(to, next.length));
  next.splice(dest, 0, moved);
  return next;
}
