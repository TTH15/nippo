export type ShiftDisplay = { shift: boolean; vehicle: boolean; meetingTime: boolean; contract?: boolean };
export const SHIFT_DISPLAY_KEY = "shifts_display_items";
export const DEFAULT_SHIFT_DISPLAY: ShiftDisplay = { shift: true, vehicle: true, meetingTime: false };

/** 新しい設定があれば優先し、以前の「簡易・標準・詳細」も引き継ぐ。 */
export function readShiftDisplay(storage: Pick<Storage, "getItem">): ShiftDisplay {
  try {
    const saved: unknown = JSON.parse(storage.getItem(SHIFT_DISPLAY_KEY) ?? "null");
    if (saved && typeof saved === "object" && "shift" in saved && "vehicle" in saved && "meetingTime" in saved &&
      typeof saved.shift === "boolean" && typeof saved.vehicle === "boolean" && typeof saved.meetingTime === "boolean") {
      return { shift: saved.shift, vehicle: saved.vehicle, meetingTime: saved.meetingTime,
        ...("contract" in saved && typeof saved.contract === "boolean" ? { contract: saved.contract } : {}) };
    }
  } catch { /* 壊れた設定は旧設定または既定値へ戻す。 */ }
  try {
    const legacy = storage.getItem("shifts_view_density");
    return { shift: true, vehicle: legacy !== "compact", meetingTime: legacy === "detail" };
  } catch { return { ...DEFAULT_SHIFT_DISPLAY }; }
}

export function toggleShiftDisplay(value: ShiftDisplay, item: keyof ShiftDisplay): ShiftDisplay {
  return { ...value, [item]: !(item === "contract" ? value.contract ?? value.vehicle : value[item]) };
}
