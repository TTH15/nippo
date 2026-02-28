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
  className,
}: {
  vehicle: VehiclePlateData;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const hasPlate =
    vehicle.number_prefix || vehicle.number_hiragana || vehicle.number_numeric;
  const size = compact ? "max-w-[140px]" : "max-w-[200px]";
  const boltOuter = compact ? 10 : 12;
  const boltInner = compact ? 8 : 10;
  const topKanjiSize = compact ? "0.95rem" : "1.9rem";
  const topNumericSize = compact ? "0.9rem" : "1.75rem";
  const bottomKanaSize = compact ? "1.1rem" : "2rem";
  const bottomNumericSize = compact ? "2.25rem" : "4rem";

  const interactive = typeof onClick === "function";
  const wrapperClass = `block text-left rounded-lg overflow-hidden ${
    interactive ? "border-2 transition-all" : "border-0"
  } ${
    interactive
      ? selected
        ? "border-slate-800 ring-2 ring-slate-400"
        : "border-slate-200 hover:border-slate-400"
      : ""
  } ${size} ${className ?? ""}`;

  const inner = hasPlate ? (
    <div
      className="relative w-full bg-black rounded-lg overflow-hidden"
      style={{
        aspectRatio: "2 / 1",
        border: "2.5px solid #b8a038",
        boxShadow: "inset 0 0 0 2px #1a1a1a, 0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      {/* ボルト穴（左上） */}
      <div className="absolute flex items-center justify-center" style={{ top: "10%", left: "12%", width: boltOuter, height: boltOuter }}>
        <div
          className="rounded-full"
          style={{
            width: boltInner,
            height: boltInner,
            background: "radial-gradient(circle at 40% 40%, #555 0%, #222 60%, #111 100%)",
          }}
        />
      </div>
      {/* ボルト穴（右上） */}
      <div className="absolute flex items-center justify-center" style={{ top: "10%", right: "12%", width: boltOuter, height: boltOuter }}>
        <div
          className="rounded-full"
          style={{
            width: boltInner,
            height: boltInner,
            background: "radial-gradient(circle at 40% 40%, #555 0%, #222 60%, #111 100%)",
          }}
        />
      </div>

      {/* プレート内容 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-baseline gap-1.5" style={{ color: "#e8d44d", marginBottom: compact ? 0 : 2, paddingTop: compact ? 6 : 12 }}>
          <span className="plate-font-kanji" style={{ fontSize: topKanjiSize, letterSpacing: "0.08em" }}>
            {vehicle.number_prefix || "京都"}
          </span>
          <span className="plate-font-numeric" style={{ fontSize: topNumericSize, letterSpacing: "0.06em" }}>
            {vehicle.number_class || "400"}
          </span>
        </div>
        <div className="flex items-center" style={{ color: "#e8d44d", gap: compact ? "0.25rem" : "0.35rem", paddingBottom: compact ? 6 : 12 }}>
          <span className="plate-font-hiragana font-bold flex items-center" style={{ fontSize: bottomKanaSize, lineHeight: 1, height: "100%" }}>
            {vehicle.number_hiragana || "わ"}
          </span>
          <span
            className="plate-font-numeric font-black tracking-wider"
            style={{
              fontSize: bottomNumericSize,
              lineHeight: 1,
              letterSpacing: "0.02em",
              textShadow: "0 0 6px rgba(232,212,77,0.3)",
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
    <button type="button" onClick={onClick} className={wrapperClass}>
      {inner}
    </button>
  ) : (
    <div className={wrapperClass}>{inner}</div>
  );
}
