import { describe, expect, it } from "vitest";
import { findDuplicateCourseIds } from "./previewLogic";

const courseIds = ["course-a", "course-b", "course-c"];

describe("findDuplicateCourseIds", () => {
  it("同じ日の別コースにいる人を検出する", () => {
    const result = findDuplicateCourseIds({ "course-a:4": ["坂田"] }, courseIds, 4, "坂田");
    expect(result).toEqual(["course-a"]);
  });

  it("同じ日の配置を移動するときは移動元だけを重複扱いしない", () => {
    const result = findDuplicateCourseIds({ "course-a:4": ["坂田"] }, courseIds, 4, "坂田", "course-a:4");
    expect(result).toEqual([]);
  });

  it("移動元以外にも同じ人がいれば重複として残す", () => {
    const result = findDuplicateCourseIds(
      { "course-a:4": ["坂田"], "course-b:4": ["坂田"] },
      courseIds,
      4,
      "坂田",
      "course-a:4",
    );
    expect(result).toEqual(["course-b"]);
  });
});
