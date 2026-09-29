import { describe, expect, it } from "vitest";
import { resolveMonthRests, fullCourseName, shiftDaySummary, shiftTime } from "../src/shifts/presentation";
import type { MeShift } from "@repo/core/types";
const shift: MeShift = { shift_date: "2026-09-02", course_name: "短名", course_full_name: "省略しない正式な配送コース名", course_color: null, slot: 1, vehicle: null };
describe("shift presentation", () => {
  it("keeps requested days and working days separate from designated rest", () => {
    const rests = resolveMonthRests(2026, 9, [shift], [{ date: "2026-09-03", kind: "requested" }, { date: "2026-09-02", kind: "requested", slot_label: "夕方便" }], true);
    expect(rests.find(r => r.date === "2026-09-01")?.kind).toBe("designated");
    expect(rests.filter(r => r.date === "2026-09-02")).toEqual([{ date: "2026-09-02", kind: "requested", slot_label: "夕方便" }]);
    expect(rests.find(r => r.date === "2026-09-03")?.kind).toBe("requested");
    expect(rests).toHaveLength(30);
  });
  it("never infers rest from failed or missing data", () => {
    expect(resolveMonthRests(2026, 9, [], [], false)).toEqual([]);
  });
  it("handles leap month and shows all unassigned days after successful reads", () => {
    expect(resolveMonthRests(2028, 2, [], [], true)).toHaveLength(29);
    expect(resolveMonthRests(2026, 2, [], [], true)).toHaveLength(28);
  });
  it("uses full course names, preserves midnight and distinguishes missing times", () => {
    expect(fullCourseName(shift)).toBe(shift.course_full_name);
    expect(fullCourseName({ ...shift, course_full_name: " " })).toBe("短名");
    expect(shiftTime("00:00:00")).toBe("00:00");
    expect(shiftTime(null)).toBe("未設定");
    expect(shiftDaySummary([shift], [{ date: shift.shift_date, kind: "requested", slot_label: "夕方便" }])).toBe("稼働1件・希望休（夕方便）");
  });
});
