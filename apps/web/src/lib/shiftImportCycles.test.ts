import { describe, expect, it } from "vitest";
import {
  SHIFT_IMPORT_IGNORE,
  encodeShiftImportCourseChoice,
  expandShiftImportCourseChoice,
  parseShiftImportCourseChoice,
} from "./shiftImportCycles";

describe("shiftImportCycles", () => {
  const cycleCourse = {
    id: "course-1",
    uses_cycles: true,
    course_cycles: [
      { cycle_no: 1, active: true },
      { cycle_no: 2, active: true },
      { cycle_no: 3, active: false },
    ],
  };

  it("コースと便番号の選択値を往復する", () => {
    const value = encodeShiftImportCourseChoice("course-1", 2);
    expect(parseShiftImportCourseChoice(value)).toEqual({ courseId: "course-1", cycleNo: 2 });
    expect(parseShiftImportCourseChoice(SHIFT_IMPORT_IGNORE)).toBeNull();
  });

  it("全サイクルを有効なC1・C2へ展開し、無効なC3は除外する", () => {
    expect(
      expandShiftImportCourseChoice({ courseId: "course-1", cycleNo: 0 }, cycleCourse),
    ).toEqual([
      { courseId: "course-1", cycleNo: 1 },
      { courseId: "course-1", cycleNo: 2 },
    ]);
  });

  it("特定便とサイクル非使用コースはそのまま返す", () => {
    expect(
      expandShiftImportCourseChoice({ courseId: "course-1", cycleNo: 2 }, cycleCourse),
    ).toEqual([{ courseId: "course-1", cycleNo: 2 }]);
    expect(
      expandShiftImportCourseChoice(
        { courseId: "course-2", cycleNo: 0 },
        { id: "course-2", uses_cycles: false },
      ),
    ).toEqual([{ courseId: "course-2", cycleNo: 0 }]);
  });
});
