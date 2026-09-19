export const VEHICLE_PAINT_PARTS = [
  { key: "hood", label: "ボンネット", material: "Paint Hood", suffix: "hood" },
  { key: "frontBumper", label: "前バンパー", material: "Paint Front Bumper", suffix: "front-bumper" },
  { key: "rearBumper", label: "後ろバンパー", material: "Paint Rear Bumper", suffix: "rear-bumper" },
] as const;
export type VehiclePaintPart = (typeof VEHICLE_PAINT_PARTS)[number]["key"];
export type VehiclePartColors = Partial<Record<VehiclePaintPart, string>>;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
export function isVehiclePartColors(v: unknown): v is VehiclePartColors {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.entries(v).every(([key, color]) => VEHICLE_PAINT_PARTS.some(p => p.key === key) && isHexColor(color));
}
export function vehiclePartColors(v: unknown): VehiclePartColors { return isVehiclePartColors(v) ? v : {}; }
/** 部位の指定 → 通常の車体色 → 元の材質色。写真仕様の固定塗装は全体色に追従しない。 */
export function colorForVehicleMaterial(material: string, bodyColor?: string | null, colors: VehiclePartColors = {}): string | null {
  const part = VEHICLE_PAINT_PARTS.find(p => p.material === material || `Fixed ${p.material}` === material);
  if (part && isHexColor(colors[part.key])) return colors[part.key]!;
  if (material.startsWith("Fixed ")) return null;
  if (part || material === "Body White" || material === "Body Crease") return isHexColor(bodyColor) ? bodyColor : null;
  return null;
}
/** どの画面でも無彩色を明るい順、有彩色を色相順に並べる。同一色は一つだけ。 */
export function orderedVehicleColors(values: readonly { label: string; value: string }[]) {
  const unique = values.filter((v, i) => isHexColor(v.value) && values.findIndex(a => a.value.toLowerCase() === v.value.toLowerCase()) === i);
  const rank = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const hue = d === 0 ? 0 : (((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) + 6) % 6);
    return [d < 0.13 ? 0 : 1, d < 0.13 ? -(r * .2126 + g * .7152 + b * .0722) : hue, -max];
  };
  return unique.sort((a, b) => { const ar = rank(a.value), br = rank(b.value); return ar[0] - br[0] || ar[1] - br[1] || ar[2] - br[2] || a.value.localeCompare(b.value); });
}
