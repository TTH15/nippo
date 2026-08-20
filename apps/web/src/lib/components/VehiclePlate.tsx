"use client";

import { PLATE_GLYPHS, PLATE_GLYPH_CANVAS, type PlateGlyphMeta } from "@/lib/plateGlyphs.generated";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamation } from "@fortawesome/free-solid-svg-icons";
import { computeOilStatus } from "@repo/core/logic/oilChange";

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

/**
 * SVG グリフで描くシリアル列。実物は刻印位置が固定なので、ハイフン枠は常に確保し
 * （＝かなの位置が桁数で動かない）、3桁未満はハイフンを刻印しない（空きのまま）。
 */
export function plateSerialGlyphSeq(raw: string): { seq: string[]; showHyphen: boolean } {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const padded = plateDigits(raw);
  return {
    seq: [padded[0], padded[1], "-", padded[2], padded[3]],
    showHyphen: digits.length === 4, // ハイフンの刻印は4桁のときだけ（3桁以下は枠が空くだけ）
  };
}

// 型の正準は core/types に集約。後方互換のためここから再エクスポートする。
import type { VehiclePlateData, PlateColor } from "@repo/core/types";
export type { VehiclePlateData };

// 実物の4種の配色。未設定は black（軽事業用）として描く（既存データは全て黒）。
const PLATE_SCHEMES: Record<
  PlateColor,
  { bg: string; frame: string; text: string; inset: string; glow: string | null }
> = {
  black: { bg: "#000000", frame: "#b8a038", text: "#e8d44d", inset: "#1a1a1a", glow: "rgba(232,212,77,0.3)" },
  yellow: { bg: "#f2c50f", frame: "#a8880a", text: "#151515", inset: "rgba(0,0,0,0.18)", glow: null },
  white: { bg: "#f4f5f1", frame: "#9aa0a6", text: "#17603e", inset: "rgba(0,0,0,0.10)", glow: null },
  green: { bg: "#0a5a40", frame: "#d5d9de", text: "#ffffff", inset: "rgba(0,0,0,0.25)", glow: null },
};

function plateScheme(color: VehiclePlateData["plate_color"]) {
  return color && color in PLATE_SCHEMES ? PLATE_SCHEMES[color as PlateColor] : PLATE_SCHEMES.black;
}

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
  color,
  scaleLenPx,
  marginTopPx,
}: {
  meta: PlateGlyphMeta;
  s: number;
  color: string;
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
        backgroundColor: color,
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
  const scheme = plateScheme(vehicle.plate_color);
  const oilStatus = computeOilStatus(vehicle);
  const oilWarning = oilStatus && oilStatus.level !== "safe" ? oilStatus : null;
  const warningLabel = oilWarning
    ? oilWarning.remaining < 0
      ? `オイル交換時期を${Math.abs(oilWarning.remaining).toLocaleString()}km超過しています`
      : `オイル交換まで残り${oilWarning.remaining.toLocaleString()}kmです`
    : "";
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

  // 実物のプレート写真の実測比率に合わせる（練馬480 れ51-14 の写真より:
  // 一連=高さの約48%・かな=約32%・上段=約24%、余白は上下左右 5〜9%。
  // 「端まで文字が入っている」感じが実物らしさの要）。240px 幅 = 120px 高基準。
  // 写真の実測比率: 上余白9% / 上段24% / 行間9% / 一連48% / 下余白9%（120px 高でほぼ等式）
  const topH = 29 * k;
  const kanaH = 27 * k; // かなは一連の半分弱・数字の高さの中央に置く（実物準拠）
  const serialH = 58 * k;

  const regionText = vehicle.number_prefix || "京都";
  const classText = vehicle.number_class || "400";
  const kanaText = vehicle.number_hiragana || "わ";
  const { seq: serialSeq, showHyphen } = plateSerialGlyphSeq(vehicle.number_numeric || "");

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
      className="relative w-full rounded-lg overflow-hidden"
      style={{
        aspectRatio: "2 / 1",
        backgroundColor: scheme.bg,
        border: `${scaleLenPx(borderWidthPx)} solid ${scheme.frame}`,
        boxShadow: `inset 0 0 0 ${scaleLenPx(insetShadowPx)} ${scheme.inset}, 0 2px 8px rgba(0,0,0,0.3)`,
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

      {/* プレート内容。実物は上段が上端・一連が下端に寄り、行間が広い（中央寄せにしない） */}
      <div className="absolute inset-0 flex flex-col items-center justify-between overflow-hidden min-w-0">
        {/* 上段: 地名 + 分類番号 */}
        <div
          className="flex items-center shrink-0"
          style={{
            color: scheme.text,
            gap: scaleLenPx(7 * k),
            paddingTop: scaleLenPx(compact ? 3.5 : 8),
          }}
        >
          {regionGlyphs ? (
            <span className="flex items-center" style={{ gap: scaleLenPx(2.5 * k) }}>
              {regionGlyphs.map((meta, i) => (
                <PlateGlyph
                  key={`r${i}`}
                  meta={meta}
                  s={topH / meta.h}
                  color={scheme.text}
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
                  <PlateGlyph meta={meta} s={topH / meta.h} color={scheme.text} scaleLenPx={scaleLenPx} />
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
            color: scheme.text,
            gap: scaleLenPx(10 * k),
            paddingBottom: scaleLenPx(compact ? 3.5 : 8),
          }}
        >
          {kanaGlyphs ? (
            <span className="flex shrink-0 self-center">
              <PlateGlyph meta={kanaGlyphs[0]} s={kanaH / kanaGlyphs[0].h} color={scheme.text} scaleLenPx={scaleLenPx} />
            </span>
          ) : (
            <span
              className="plate-font-hiragana font-bold flex-shrink-0 self-center"
              style={{ fontSize: scaleLenPx(bottomKanaSizePx), lineHeight: 1 }}
            >
              {kanaText}
            </span>
          )}
          {serialGlyphs ? (
            <span
              className="flex items-start shrink-0"
              style={{
                gap: scaleLenPx(7.5 * k),
                height: scaleLenPx(serialH),
                filter: glow && scheme.glow ? `drop-shadow(0 0 6px ${scheme.glow})` : "none",
              }}
            >
              {serialGlyphs.map((meta, i) => {
                const glyph = (
                  <PlateGlyph
                    meta={meta}
                    s={serialScale}
                    color={scheme.text}
                    scaleLenPx={scaleLenPx}
                    marginTopPx={(meta.y - serialCat.minY) * serialScale}
                  />
                );
                if (serialSeq[i] === "-") {
                  // ハイフン枠は常に確保（実物は刻印位置固定）。3桁未満は刻印せず空きのまま
                  return (
                    <span key={`s${i}`} className="flex shrink-0" style={showHyphen ? undefined : { visibility: "hidden" }}>
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
                textShadow: glow && scheme.glow ? `0 0 6px ${scheme.glow}` : "none",
                minWidth: 0,
              }}
            >
              {formatPlateNumeric(vehicle.number_numeric || "")}
            </span>
          )}
        </div>
      </div>
      {oilWarning ? (
        <span
          role="img"
          aria-label={warningLabel}
          title={warningLabel}
          className={`absolute right-[2%] top-[2%] z-10 flex items-center justify-center rounded-full border-2 border-white text-white shadow-md ${
            oilWarning.level === "critical" ? "bg-red-600" : "bg-amber-500"
          }`}
          style={{ width: "22%", aspectRatio: "1 / 1", fontSize: scaleLenPx(compact ? 10 : 24) }}
        >
          <FontAwesomeIcon icon={faExclamation} aria-hidden />
        </span>
      ) : null}
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
