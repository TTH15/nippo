import type { ReportContentUnit } from "./reportContent";

export type ReportVehicleNumber = { number: string; source: "report" | "confirmed_image" | "ocr" };
const keys = new Set(["vehicle_number", "vehicle_plate", "plate_number", "number_numeric"]);
const labels = new Set(["車両番号", "車両ナンバー", "車番", "ナンバープレート"]);
export function isVehicleNumberField(key: string, label?: string | null): boolean {
  return keys.has(key) || labels.has(label?.trim() ?? "");
}
export function vehicleNumberText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  // 実際の番号だけを表示する。未登録・車種・自由記述を車番へ変換しない。
  if (!text || text.length > 40 || !/^[\p{L}\d ・･-]+$/u.test(text) || !/\d/.test(text)) return null;
  if (!/(?:^|[^\d])\d[\d ・･-]{0,8}$/.test(text)) return null;
  const serial = text.match(/\d[\d ・･-]*$/)?.[0].replace(/\D/g, "") ?? "";
  return serial.length >= 1 && serial.length <= 4 ? text : null;
}
export function reportVehicleNumber(content?: ReportContentUnit[]): ReportVehicleNumber | null {
  const values = new Set((content ?? []).flatMap(unit => unit.fields
    .filter(field => isVehicleNumberField(field.fieldKey, field.label))
    .map(field => vehicleNumberText(field.valueText ?? field.valueNum)).filter((value): value is string => !!value)));
  return values.size === 1 ? { number: [...values][0], source: "report" } : null;
}
