import { describe, expect, it } from "vitest";
import { readShiftDisplay, toggleShiftDisplay, SHIFT_DISPLAY_KEY } from "./shiftDisplay";
const storage = (data: Record<string, string>) => ({ getItem: (key: string) => data[key] ?? null });
describe("本番シフトの表示設定", () => {
  it.each([
    ["compact", { shift: true, vehicle: false, meetingTime: false }],
    ["standard", { shift: true, vehicle: true, meetingTime: false }],
    ["detail", { shift: true, vehicle: true, meetingTime: true }],
  ])("旧%s設定を引き継ぐ", (legacy, expected) => expect(readShiftDisplay(storage({ shifts_view_density: legacy }))).toEqual(expected));
  it("新しい表示項目を優先する", () => {
    const value = { shift: false, vehicle: true, meetingTime: true };
    expect(readShiftDisplay(storage({ [SHIFT_DISPLAY_KEY]: JSON.stringify(value), shifts_view_density: "compact" }))).toEqual(value);
  });
  it("壊れた設定・保存禁止でも開ける", () => {
    expect(readShiftDisplay(storage({ [SHIFT_DISPLAY_KEY]: "{", shifts_view_density: "compact" })).vehicle).toBe(false);
    expect(readShiftDisplay({ getItem: () => { throw new Error("blocked"); } })).toEqual({ shift: true, vehicle: true, meetingTime: false });
  });
  it("全項目オフの選択も保持する", () => {
    expect(toggleShiftDisplay({ shift: false, vehicle: true, meetingTime: false }, "vehicle").vehicle).toBe(false);
    expect(toggleShiftDisplay({ shift: true, vehicle: true, meetingTime: false }, "vehicle")).toEqual({ shift: true, vehicle: false, meetingTime: false });
  });
});
