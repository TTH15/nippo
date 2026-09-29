import { buildReportItems, reportFormKey } from "@repo/core/logic/dailyReport";
import type { ShiftForm, ValueMap } from "@repo/core/types";

// メーターは写真から別途確定する。省略により保存済みの解析値も上書きしない。
export function buildPhotoReportItems(shifts: ShiftForm[], values: ValueMap, vehicleId: string | null) {
  for (const shift of shifts) {
    for (const unit of shift.units) {
      for (const field of unit.fields) {
        if (field.inputType === "INT" && field.required && !values[reportFormKey(shift.courseId, shift.cycleNo)]?.[unit.id]?.[field.fieldKey]?.trim()) {
          throw new Error(`${shift.courseName}${shift.cycleLabel ? ` ${shift.cycleLabel}` : ""}の「${field.label}」を入力してください。`);
        }
      }
    }
  }
  return buildReportItems(shifts, values, vehicleId, null).map(({ meterValue: _meter, ...item }) => ({
    ...item,
    entries: item.entries.map(entry => {
      const raw = values[reportFormKey(item.courseId, item.cycleNo)]?.[entry.unitId]?.[entry.fieldKey];
      // 共通の旧フォームは空欄を0とする。写真方式では未読と0件を区別する。
      return entry.valueNum !== null && !raw?.trim() ? { ...entry, valueNum: null } : entry;
    }),
  }));
}
