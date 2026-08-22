import { describe, expect, it } from "vitest";
import { normalizeCourseTime } from "./CourseTimeField";

describe("normalizeCourseTime", () => {
  it.each([
    ["930", "09:30"],
    ["９３０", "09:30"],
    ["09:30", "09:30"],
    ["9", "09:00"],
    ["", ""],
  ])("%s を %s に整形する", (input, expected) => {
    expect(normalizeCourseTime(input)).toBe(expected);
  });

  it("時刻の範囲を超えた値を上限へ補正する", () => {
    expect(normalizeCourseTime("29:99")).toBe("23:59");
  });
});
