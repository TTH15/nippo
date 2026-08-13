"use client";

import { PLATE_GLYPHS, PLATE_GLYPH_CANVAS, type PlateGlyphMeta } from "@/lib/plateGlyphs.generated";

export function plateDigits(raw: string): [string, string, string, string] {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const arr: string[] = Array(4).fill("・");
  for (let i = 0; i < digits.length; i++) {
    arr[4 - digits.length + i] = digits[i];
  }
  return arr as [string, string, string, string];
}

export function formatPlateNumeric(raw: string): string {
  const d = plateDigits(raw);
  const digits = raw.replace(/\D/g, "");
  const sep = digits.length === 4 ? "-" : " ";
  return `${d[0]}${d[1]}${sep}${d[2]}${d[3]}`;
}

/** SVG グリフで描くシリアル列。実物準拠でハイフンは両側に数字がある場合（3桁以上）のみ。 */
export function plateSerialGlyphSeq(raw: string): string[] {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const padded = plateDigits(raw);
  if (digits.length >= 3) return [padded[0], padded[1], "-", padded[2], padded[3]];
  return [...padded];
}

// 型の正準は core/types に集約。後方互換のためここから再エクスポートする。
import type { VehiclePlateData } from "@repo/core/types";
export type { VehiclePlateData };

const PLATE_TEXT_COLOR = "#e8d44d";

/** 文字列の全文字ぶんグリフが揃っていれば返す（1文字でも欠けたらフォントにフォールバック） */
function lookupGlyphs(
  category: keyof typeof PLATE_GLYPHS,
  text: string,
): PlateGlyphMeta[] | null {
  const metas = [...text].map((ch) => PLATE_GLYPHS[category].glyphs[ch]);
  return metas.every((m): m is PlateGlyphMeta => Boolean(m)) ? (metas as PlateGlyphMeta[]) : null;
}

/**
 * SVG グリフ1文字。黒パスの SVG を CSS mask にして黄文字で塗る。
 * s = キャンバス単位 → px の倍率。bbox で切り出し、mask-size/position でキャンバス全体を重ねる。
 */
function PlateGlyph({
  meta,
  s,
  scaleLenPx,
  marginTopPx,
}: {
  meta: PlateGlyphMeta;
  s: number;
  scaleLenPx: (v: number) => string;
  marginTopPx?: number;
}) {
  const maskImage = `url("${meta.src}")`;
  const maskSize = `${scaleLenPx(PLATE_GLYPH_CANVAS * s)} ${scaleLenPx(PLATE_GLYPH_CANVAS * s)}`;
  const maskPosition = `${scaleLenPx(-meta.x * s)} ${scaleLenPx(-meta.y * s)}`;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={{
        width: scaleLenPx(meta.w * s),
        height: scaleLenPx(meta.h * s),
        marginTop: marginTopPx !== undefined ? scaleLenPx(marginTopPx) : undefined,
        backgroundColor: PLATE_TEXT_COLOR,
        maskImage,
        WebkitMaskImage: maskImage,
        maskSize,
        WebkitMaskSize: maskSize,
        maskPosition,
        WebkitMaskPosition: maskPosition,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}

export function VehiclePlate({
  vehicle,
  selected,
  onClick,
  compact = false,
  glow = true,
  className,
}: {
  vehicle: VehiclePlateData;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
  glow?: boolean;
  className?: string;
}) {
  const hasPlate =
    vehicle.number_prefix || vehicle.number_hiragana || vehicle.number_numeric;
  const size = compact ? "max-w-[100px] min-w-0" : "max-w-[240px]";
  // plate の見た目は「外側の幅」に比例させる（デバイス依存を減らす）
  // cqw: コンテナ幅の 1% なので、100cqw がコンテナ幅になる
  const refW = compact ? 100 : 240;
  // 単位を揃えて、スケール係数（無次元）にする
  const scaleExpr = `(100cqw / ${refW}px)`;
  const scaleLenPx = (v: number) => `calc(${v}px * ${scaleExpr})`;
  // グリフ寸法は幅240pxのプレートを基準に決め、compact は同比率で縮める
  const k = refW / 240;

  const boltOuterPx = compact ? 5 : 12;
  const boltInnerPx = compact ? 3 : 10;
  const borderWidthPx = compact ? 1.5 : 2.5;
  const insetShadowPx = compact ? 1 : 2;

  // フォントフォールバック用（グリフが無い文字が混ざるセグメントだけ従来描画）
  const topKanjiSizePx = compact ? 0.65 * 16 : 1.9 * 16;
  const topNumericSizePx = compact ? 0.6 * 16 : 1.75 * 16;
  const bottomKanaSizePx = compact ? 0.7 * 16 : 2.0 * 16;
  const bottomNumericSizePx = compact ? 0.9 * 16 : 4.0 * 16;

  // 実物の縦比率（330×165mm: 地名・分類=40mm ≒ 29px、かな=40mm、一連=80mm ≒ 58px）を
  // ボルト・余白と両立する範囲で当てる（240px 幅 = 120px 高基準）。
  const topH = 25 * k;
  const kanaH = 29 * k;
  const serialH = 53 * k;

  const regionText = vehicle.number_prefix || "京都";
  const classText = vehicle.number_class || "400";
  const kanaText = vehicle.number_hiragana || "わ";
  const serialSeq = plateSerialGlyphSeq(vehicle.number_numeric || "");

  const regionGlyphs = lookupGlyphs("kanji", regionText);
  const classGlyphs = lookupGlyphs("classification", classText);
  const kanaGlyphs = lookupGlyphs("hiragana", kanaText);
  const serialGlyphs = lookupGlyphs("serial", serialSeq.join(""));

  // 漢字・かな・分類: グリフ単体を行の高さへ正規化（素材ごとのキャンバス縮尺差を吸収）。
  // シリアル: 数字の高さ（refH）を基準にカテゴリ一括の縮尺にして、
  // 「・」「-」の小ささと縦位置（キャンバス由来）をそのまま保つ。
  const serialCat = PLATE_GLYPHS.serial;
  const serialScale = serialH / serialCat.refH;
  // 実物は等ピッチ（幅の細い「1」も1桁ぶんの枠を占める）。数字・「・」は
  // 最大数字幅のスロット中央に置き、「-」だけ自然幅で挟む。
  const maxGlyphW = (glyphs: Record<string, PlateGlyphMeta>, re: RegExp) =>
    Math.max(...Object.entries(glyphs).filter(([ch]) => re.test(ch)).map(([, m]) => m.w));
  const serialSlotW = maxGlyphW(serialCat.glyphs, /^\d$/);
  const classCat = PLATE_GLYPHS.classification;
  const classSlotW = maxGlyphW(classCat.glyphs, /^\d$/);

  const interactive = typeof onClick === "function";
  const wrapperClass = `block text-left rounded-lg overflow-hidden ${
    interactive ? "border-2 transition-all" : "border-0"
  } ${
    interactive
      ? selected
        ? "border-slate-900 ring-2 ring-slate-400 shadow-md"
        : "border-slate-200 hover:border-slate-400 opacity-60"
      : ""
  } ${size} ${className ?? ""}`;

  // wrapper に container-type を設定し、内部の cqw を有効にする
  const wrapperStyle: React.CSSProperties = { containerType: "inline-size" } as React.CSSProperties;

  const inner = hasPlate ? (
    <div
      className="relative w-full bg-black rounded-lg overflow-hidden"
      style={{
        aspectRatio: "2 / 1",
        border: `${scaleLenPx(borderWidthPx)} solid #b8a038`,
        boxShadow: `inset 0 0 0 ${scaleLenPx(insetShadowPx)} #1a1a1a, 0 2px 8px rgba(0,0,0,0.3)`,
      }}
    >
      {/* ボルト穴（左上） */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          top: "10%",
          left: "12%",
          width: scaleLenPx(boltOuterPx),
          height: scaleLenPx(boltOuterPx),
        }}
      >
        <div
          className="rounded-full"
          style={{
            width: scaleLenPx(boltInnerPx),
            height: scaleLenPx(boltInnerPx),
            background: "radial-gradient(circle at 40% 40%, #555 0%, #222 60%, #111 100%)",
          }}
        />
      </div>
      {/* ボルト穴（右上） */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          top: "10%",
          right: "12%",
          width: scaleLenPx(boltOuterPx),
          height: scaleLenPx(boltOuterPx),
        }}
      >
        <div
          className="rounded-full"
          style={{
            width: scaleLenPx(boltInnerPx),
            height: scaleLenPx(boltInnerPx),
            background: "radial-gradient(circle at 40% 40%, #555 0%, #222 60%, #111 100%)",
          }}
        />
      </div>

      {/* プレート内容 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden min-w-0">
        {/* 上段: 地名 + 分類番号 */}
        <div
          className="flex items-center shrink-0"
          style={{
            color: PLATE_TEXT_COLOR,
            gap: scaleLenPx(10 * k),
            marginBottom: scaleLenPx(5 * k),
            paddingTop: scaleLenPx(compact ? 4 : 10),
          }}
        >
          {regionGlyphs ? (
            <span className="flex items-center" style={{ gap: scaleLenPx(2.5 * k) }}>
              {regionGlyphs.map((meta, i) => (
                <PlateGlyph
                  key={`r${i}`}
                  meta={meta}
                  s={topH / meta.h}
                  scaleLenPx={scaleLenPx}
                />
              ))}
            </span>
          ) : (
            <span
              className="plate-font-kanji shrink-0"
              style={{ fontSize: scaleLenPx(topKanjiSizePx), letterSpacing: "0.08em", lineHeight: 1 }}
            >
              {regionText}
            </span>
          )}
          {classGlyphs ? (
            <span className="flex items-center" style={{ gap: scaleLenPx(1 * k) }}>
              {classGlyphs.map((meta, i) => (
                <span
                  key={`c${i}`}
                  className="flex shrink-0 justify-center"
                  style={{ width: scaleLenPx(classSlotW * (topH / classCat.refH)) }}
                >
                  <PlateGlyph meta={meta} s={topH / meta.h} scaleLenPx={scaleLenPx} />
                </span>
              ))}
            </span>
          ) : (
            <span
              className="plate-font-numeric shrink-0"
              style={{ fontSize: scaleLenPx(topNumericSizePx), letterSpacing: "0.06em", lineHeight: 1 }}
            >
              {classText}
            </span>
          )}
        </div>
        {/* 下段: かな + 一連番号 */}
        <div
          className="flex items-end justify-center min-w-0 w-full px-0.5"
          style={{
            color: PLATE_TEXT_COLOR,
            gap: scaleLenPx(12 * k),
            paddingBottom: scaleLenPx(compact ? 4 : 10),
          }}
        >
          {kanaGlyphs ? (
            <span
              className="flex shrink-0"
              style={{ marginBottom: scaleLenPx(2 * k) }}
            >
              <PlateGlyph meta={kanaGlyphs[0]} s={kanaH / kanaGlyphs[0].h} scaleLenPx={scaleLenPx} />
            </span>
          ) : (
            <span
              className="plate-font-hiragana font-bold flex-shrink-0"
              style={{ fontSize: scaleLenPx(bottomKanaSizePx), lineHeight: 1 }}
            >
              {kanaText}
            </span>
          )}
          {serialGlyphs ? (
            <span
              className="flex items-start shrink-0"
              style={{
                gap: scaleLenPx(6 * k),
                height: scaleLenPx(serialH),
                filter: glow ? "drop-shadow(0 0 6px rgba(232,212,77,0.3))" : "none",
              }}
            >
              {serialGlyphs.map((meta, i) => {
                const glyph = (
                  <PlateGlyph
                    meta={meta}
                    s={serialScale}
                    scaleLenPx={scaleLenPx}
                    marginTopPx={(meta.y - serialCat.minY) * serialScale}
                  />
                );
                if (serialSeq[i] === "-") {
                  return (
                    <span key={`s${i}`} className="flex shrink-0">
                      {glyph}
                    </span>
                  );
                }
                return (
                  <span
                    key={`s${i}`}
                    className="flex shrink-0 justify-center"
                    style={{ width: scaleLenPx(serialSlotW * serialScale) }}
                  >
                    {glyph}
                  </span>
                );
              })}
            </span>
          ) : (
            <span
              className="plate-font-numeric font-black tracking-wider overflow-hidden max-w-full"
              style={{
                fontSize: scaleLenPx(bottomNumericSizePx),
                lineHeight: 1,
                letterSpacing: "0.02em",
                textShadow: glow ? "0 0 6px rgba(232,212,77,0.3)" : "none",
                minWidth: 0,
              }}
            >
              {formatPlateNumeric(vehicle.number_numeric || "")}
            </span>
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="bg-slate-100 aspect-[2/1] flex items-center justify-center text-slate-500 text-sm p-2 rounded-lg">
      {[vehicle.manufacturer, vehicle.brand].filter(Boolean).join(" ") || "車両"}
    </div>
  );

  return interactive ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!selected}
      className={wrapperClass}
      style={wrapperStyle}
    >
      {inner}
    </button>
  ) : (
    <div className={wrapperClass} style={wrapperStyle}>
      {inner}
    </div>
  );
}
