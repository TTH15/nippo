import { describe, expect, it } from "vitest";
import { isMemoRangeValid, isValidMemoDate, parseShiftMemoDays } from "./schema";

const COURSE_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "22222222-2222-4222-8222-222222222222";

describe("shift memo schema", () => {
  it("実在する日付と31日以内の期間だけを許可する", () => {
    expect(isValidMemoDate("2026-02-28")).toBe(true);
    expect(isValidMemoDate("2026-02-30")).toBe(false);
    expect(isMemoRangeValid("2026-08-01", "2026-08-31")).toBe(true);
    expect(isMemoRangeValid("2026-08-01", "2026-09-01")).toBe(false);
  });

  it("登録ドライバー札と自由文字札を正規化する", () => {
    const result = parseShiftMemoDays(
      [
        {
          date: "2026-08-16",
          placements: [
            { id: "p-1", courseId: COURSE_ID, cycleNo: 1, driverId: DRIVER_ID, label: " 坂田 " },
            { id: "p-2", courseId: COURSE_ID, cycleNo: 1, driverId: null, label: " 応援1名 " },
          ],
          note: "午前中に確認",
        },
      ],
      { allowedCourseIds: new Set([COURSE_ID]), allowedDriverIds: new Set([DRIVER_ID]) },
    );
    expect(result).toEqual({
      ok: true,
      days: [
        {
          date: "2026-08-16",
          placements: [
            { id: "p-1", courseId: COURSE_ID, cycleNo: 1, driverId: DRIVER_ID, label: "坂田" },
            { id: "p-2", courseId: COURSE_ID, cycleNo: 1, driverId: null, label: "応援1名" },
          ],
          note: "午前中に確認",
        },
      ],
    });
  });

  it("別組織のコース・ドライバーIDを拒否する", () => {
    const result = parseShiftMemoDays(
      [
        {
          date: "2026-08-16",
          placements: [{ id: "p-1", courseId: COURSE_ID, cycleNo: 0, driverId: DRIVER_ID, label: "坂田" }],
          note: "",
        },
      ],
      { allowedCourseIds: new Set(), allowedDriverIds: new Set() },
    );
    expect(result).toEqual({ ok: false, message: "コースが不正です" });
  });

  it("同じ日付内で札IDが重複する入力を拒否する", () => {
    const result = parseShiftMemoDays([
      {
        date: "2026-08-16",
        placements: [
          { id: "same", courseId: COURSE_ID, cycleNo: 0, driverId: null, label: "未定" },
          { id: "same", courseId: COURSE_ID, cycleNo: 0, driverId: null, label: "応援" },
        ],
        note: "",
      },
    ]);
    expect(result).toEqual({ ok: false, message: "名前札のIDが不正または重複しています" });
  });
});

