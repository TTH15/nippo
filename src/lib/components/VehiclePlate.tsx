"use client";

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

export type VehiclePlateData = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

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

  const boltOuterPx = compact ? 5 : 12;
  const boltInnerPx = compact ? 3 : 10;
  const borderWidthPx = compact ? 1.5 : 2.5;
  const insetShadowPx = compact ? 1 : 2;

  // rem -> px 換算（UI が崩れないように厳密に寄せるため、px を base にスケールする）
  const topKanjiSizePx = compact ? 0.65 * 16 : 1.9 * 16;
  const topNumericSizePx = compact ? 0.6 * 16 : 1.75 * 16;
  const bottomKanaSizePx = compact ? 0.7 * 16 : 2.0 * 16;
  const bottomNumericSizePx = compact ? 0.9 * 16 : 4.0 * 16;

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
        <div
          className="flex items-baseline gap-0.5 shrink-0"
          style={{
            color: "#e8d44d",
            marginBottom: compact ? 0 : scaleLenPx(2),
            paddingTop: scaleLenPx(compact ? 4 : 12),
          }}
        >
          <span className="plate-font-kanji shrink-0" style={{ fontSize: scaleLenPx(topKanjiSizePx), letterSpacing: "0.08em" }}>
            {vehicle.number_prefix || "京都"}
          </span>
          <span
            className="plate-font-numeric shrink-0"
            style={{ fontSize: scaleLenPx(topNumericSizePx), letterSpacing: "0.06em" }}
          >
            {vehicle.number_class || "400"}
          </span>
        </div>
        <div
          className="flex items-center justify-center min-w-0 w-full px-0.5"
          style={{
            color: "#e8d44d",
            gap: scaleLenPx(compact ? 0.15 * 16 : 0.35 * 16),
            paddingBottom: scaleLenPx(compact ? 4 : 12),
          }}
        >
          <span className="plate-font-hiragana font-bold flex-shrink-0" style={{ fontSize: scaleLenPx(bottomKanaSizePx), lineHeight: 1 }}>
            {vehicle.number_hiragana || "わ"}
          </span>
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
