// ナンバープレート SVG グリフのバウンディングボックスを算出し、
// src/lib/plateGlyphs.generated.ts を生成する。
// 素材: public/number_plate/{kanji,hiragana,classification_numbers,serial_numbers}/*.svg
//   （全ファイル 283.4646 四方の正方形キャンバス・黒シェイプ。位置=実寸の相対関係を保っている前提）
// 実行: cd apps/web && npx tsx src/scripts/generate-plate-glyphs.ts
//   SVG を追加・差し替えたら再実行する。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "public/number_plate");
const OUT = path.resolve(process.cwd(), "src/lib/plateGlyphs.generated.ts");
const CANVAS = 283.4646;

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}
function addPoint(b: BBox, x: number, y: number) {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

// ---- transform="translate(..) rotate(..) ..." → 2D 行列 ----
type Mat = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
function matMul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function parseTransform(str: string | null): Mat {
  if (!str) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(translate|rotate|scale|matrix)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(str))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = IDENTITY;
    if (match[1] === "translate") t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    else if (match[1] === "scale") t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    else if (match[1] === "matrix") t = [args[0], args[1], args[2], args[3], args[4], args[5]];
    else if (match[1] === "rotate") {
      const a = ((args[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
      t = matMul(
        matMul([1, 0, 0, 1, cx, cy], [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
        [1, 0, 0, 1, -cx, -cy],
      );
    }
    m = matMul(m, t);
  }
  return m;
}

// ---- path d のバウンディングボックス（ベジェは10分割サンプリング）----
function bezier3(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
function bezier2(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

function pathBBox(d: string, m: Mat, b: BBox) {
  // 数値は小数点を1つしか含まない（".5.3" は 2 つの数値）。貪欲マッチで連結しないよう分岐で書く。
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let px: number | null = null; // 直前の制御点（S/T 用）
  let py: number | null = null;
  const num = () => Number(tokens[i++]);
  const mark = (x: number, y: number) => {
    const [ax, ay] = apply(m, x, y);
    addPoint(b, ax, ay);
  };
  const sampleCubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    for (let t = 0.1; t < 1; t += 0.1) {
      mark(bezier3(cx, x1, x2, x, t), bezier3(cy, y1, y2, y, t));
    }
    mark(x, y);
    px = x2;
    py = y2;
    cx = x;
    cy = y;
  };
  const sampleQuad = (x1: number, y1: number, x: number, y: number) => {
    for (let t = 0.1; t < 1; t += 0.1) {
      mark(bezier2(cx, x1, x, t), bezier2(cy, y1, y, t));
    }
    mark(x, y);
    px = x1;
    py = y1;
    cx = x;
    cy = y;
  };
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[A-Za-z]$/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd === "Z" || cmd === "z") {
        cx = sx;
        cy = sy;
        continue;
      }
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        cx = sx = x;
        cy = sy = y;
        mark(x, y);
        cmd = rel ? "l" : "L"; // 後続座標は暗黙の LineTo
        px = py = null;
        break;
      }
      case "L": {
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        cx = x;
        cy = y;
        mark(x, y);
        px = py = null;
        break;
      }
      case "H": {
        const x = num() + (rel ? cx : 0);
        cx = x;
        mark(x, cy);
        px = py = null;
        break;
      }
      case "V": {
        const y = num() + (rel ? cy : 0);
        cy = y;
        mark(cx, y);
        px = py = null;
        break;
      }
      case "C": {
        const x1 = num() + (rel ? cx : 0);
        const y1 = num() + (rel ? cy : 0);
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        sampleCubic(x1, y1, x2, y2, x, y);
        break;
      }
      case "S": {
        const x1 = px != null && py != null ? 2 * cx - px : cx;
        const y1 = px != null && py != null ? 2 * cy - py : cy;
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        sampleCubic(x1, y1, x2, y2, x, y);
        break;
      }
      case "Q": {
        const x1 = num() + (rel ? cx : 0);
        const y1 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        sampleQuad(x1, y1, x, y);
        break;
      }
      case "T": {
        const x1 = px != null && py != null ? 2 * cx - px : cx;
        const y1 = px != null && py != null ? 2 * cy - py : cy;
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        sampleQuad(x1, y1, x, y);
        break;
      }
      case "A": {
        // 円弧は端点のみ（この素材では使われていない想定の保険）
        i += 5; // rx ry rot large-arc sweep
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        cx = x;
        cy = y;
        mark(x, y);
        px = py = null;
        break;
      }
      default:
        i++;
    }
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** トレース残骸の白シェイプ（fill="#fdfcfc" 等）や fill="none" を除外する */
function isInkShape(tag: string): boolean {
  const fill = attr(tag, "fill");
  if (!fill) return true; // fill なし = 黒
  if (fill === "none") return false;
  const hex = fill.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return true; // 色名などは判定せず採用
  const [r, g, b] =
    hex.length === 3
      ? [...hex].map((c) => parseInt(c + c, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((c) => parseInt(c, 16));
  return (r + g + b) / 3 < 0xcc; // 明るすぎるシェイプは「地」とみなす
}

function fileBBox(svg: string): BBox {
  const b = emptyBBox();
  // path / rect / circle / ellipse / polygon（transform 対応）
  for (const tag of svg.match(/<(path|rect|circle|ellipse|polygon)\b[^>]*>/g) ?? []) {
    if (!isInkShape(tag)) continue;
    const m = parseTransform(attr(tag, "transform"));
    if (tag.startsWith("<path")) {
      const d = attr(tag, "d");
      if (d) pathBBox(d, m, b);
    } else if (tag.startsWith("<rect")) {
      const x = Number(attr(tag, "x") ?? 0);
      const y = Number(attr(tag, "y") ?? 0);
      const w = Number(attr(tag, "width") ?? 0);
      const h = Number(attr(tag, "height") ?? 0);
      for (const [px, py] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        const [ax, ay] = apply(m, px, py);
        addPoint(b, ax, ay);
      }
    } else if (tag.startsWith("<circle") || tag.startsWith("<ellipse")) {
      const cx = Number(attr(tag, "cx") ?? 0);
      const cy = Number(attr(tag, "cy") ?? 0);
      const rx = Number(attr(tag, "rx") ?? attr(tag, "r") ?? 0);
      const ry = Number(attr(tag, "ry") ?? attr(tag, "r") ?? 0);
      // 8方位で近似（transform 込み）
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const [ax, ay] = apply(m, cx + rx * Math.cos(a), cy + ry * Math.sin(a));
        addPoint(b, ax, ay);
      }
    } else if (tag.startsWith("<polygon")) {
      const pts = (attr(tag, "points") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      for (let j = 0; j + 1 < pts.length; j += 2) {
        const [ax, ay] = apply(m, pts[j], pts[j + 1]);
        addPoint(b, ax, ay);
      }
    }
  }
  return b;
}

const CATEGORIES: { key: string; dir: string; prefix: string }[] = [
  { key: "kanji", dir: "kanji", prefix: "kanji_" },
  { key: "hiragana", dir: "hiragana", prefix: "" },
  { key: "classification", dir: "classification_numbers", prefix: "classification_" },
  { key: "serial", dir: "serial_numbers", prefix: "serial_numbers_" },
];

const round = (v: number) => Math.round(v * 100) / 100;
const out: string[] = [];
out.push("// このファイルは自動生成。編集しないこと。");
out.push("// 再生成: cd apps/web && npx tsx src/scripts/generate-plate-glyphs.ts");
out.push(`export const PLATE_GLYPH_CANVAS = ${CANVAS};`);
out.push("export type PlateGlyphMeta = { src: string; x: number; y: number; w: number; h: number };");
out.push(
  "export type PlateGlyphCategory = { glyphs: Record<string, PlateGlyphMeta>; refH: number; minY: number };",
);

const catEntries: string[] = [];
for (const cat of CATEGORIES) {
  const dir = path.join(ROOT, cat.dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));
  const glyphs: string[] = [];
  let refH = 0;
  let minY = Infinity;
  for (const file of files.sort()) {
    const ch = file.replace(cat.prefix, "").replace(".svg", "");
    const b = fileBBox(fs.readFileSync(path.join(dir, file), "utf8"));
    if (!Number.isFinite(b.minX)) {
      console.warn(`skip (no shapes): ${file}`);
      continue;
    }
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    refH = Math.max(refH, h);
    minY = Math.min(minY, b.minY);
    glyphs.push(
      `    ${JSON.stringify(ch)}: { src: "/number_plate/${cat.dir}/${encodeURIComponent(file)}", x: ${round(b.minX)}, y: ${round(b.minY)}, w: ${round(w)}, h: ${round(h)} },`,
    );
    console.log(`${cat.key} ${ch}: x=${round(b.minX)} y=${round(b.minY)} w=${round(w)} h=${round(h)}`);
  }
  catEntries.push(
    `  ${cat.key}: {\n    glyphs: {\n${glyphs.map((g) => "  " + g).join("\n")}\n    },\n    refH: ${round(refH)},\n    minY: ${round(minY)},\n  },`,
  );
}
out.push(`export const PLATE_GLYPHS: Record<"kanji" | "hiragana" | "classification" | "serial", PlateGlyphCategory> = {`);
out.push(catEntries.join("\n"));
out.push("};");
fs.writeFileSync(OUT, out.join("\n") + "\n");
console.log(`\nwrote ${OUT}`);
