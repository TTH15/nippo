import { describe, expect, it } from "vitest";
import { assignedPersonCount, findDuplicateCourseIds, shortageCount } from "./previewLogic";

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

describe("shortageCount", () => {
  it("同じ人が重複していても1人として数える", () => {
    expect(assignedPersonCount(["坂田", "坂田", "廣瀬"])).toBe(2);
    expect(shortageCount(true, 3, ["坂田", "坂田", "廣瀬"])).toBe(1);
  });

  it("非稼働日は不足として数えない", () => {
    expect(shortageCount(false, 2, [])).toBe(0);
  });

  it("必要人数を満たしていれば不足0になる", () => {
    expect(shortageCount(true, 2, ["坂田", "廣瀬"])).toBe(0);
  });
});
