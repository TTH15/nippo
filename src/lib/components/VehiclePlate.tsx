"use client";

function plateDigits(raw: string): [string, string, string, string] {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const arr: string[] = Array(4).fill("・");
  for (let i = 0; i < digits.length; i++) {
    arr[4 - digits.length + i] = digits[i];
  }
  return arr as [string, string, string, string];
}

function formatPlateNumeric(raw: string): string {
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
  name?: string;
};

export function VehiclePlate({
  vehicle,
  selected,
  onClick,
  compact = false,
}: {
  vehicle: VehiclePlateData;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  const hasPlate =
    vehicle.number_prefix || vehicle.number_hiragana || vehicle.number_numeric;
  const size = compact ? "max-w-[140px]" : "max-w-[200px]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`block text-left rounded-lg overflow-hidden border-2 transition-all ${
        selected
          ? "border-slate-800 ring-2 ring-slate-400"
          : "border-slate-200 hover:border-slate-400"
      } ${size}`}
    >
      {hasPlate ? (
        <div
          className="relative bg-black overflow-hidden"
          style={{
            aspectRatio: "2 / 1",
            border: "2px solid #b8a038",
            boxShadow: "inset 0 0 0 1px #1a1a1a",
          }}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div
              className="flex items-baseline gap-0.5"
              style={{ color: "#e8d44d", fontSize: compact ? "0.75rem" : "1rem" }}
            >
              <span className="plate-font-kanji">
                {vehicle.number_prefix || "京都"}
              </span>
              <span className="plate-font-numeric">
                {vehicle.number_class || "400"}
              </span>
            </div>
            <div
              className="flex items-center"
              style={{
                color: "#e8d44d",
                fontSize: compact ? "1rem" : "1.5rem",
                gap: "0.2rem",
              }}
            >
              <span className="plate-font-hiragana font-bold">
                {vehicle.number_hiragana || "わ"}
              </span>
              <span className="plate-font-numeric font-black tracking-wider">
                {formatPlateNumeric(vehicle.number_numeric || "")}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-100 aspect-[2/1] flex items-center justify-center text-slate-500 text-sm p-2">
          {vehicle.name || "車両"}
        </div>
      )}
    </button>
  );
}
