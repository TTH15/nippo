import { describe, expect, it } from "vitest";
import { assignedPersonCount, exportBodySlices, exportEdgeVelocity, findDuplicateCourseIds, selectedShortageCount, shortageCount } from "./previewLogic";

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

  it("書き出し時は選択された担当枠の不足だけを合計する", () => {
    const shortages = { "course-a": 2, "course-b": 3, "course-c": 4 };
    expect(selectedShortageCount(["course-b"], (courseId) => shortages[courseId as keyof typeof shortages])).toBe(3);
    expect(selectedShortageCount(["course-a", "course-c"], (courseId) => shortages[courseId as keyof typeof shortages])).toBe(6);
  });
});

describe("exportEdgeVelocity", () => {
  it("表示領域の左端・上端では負方向へ進む", () => {
    expect(exportEdgeVelocity(250, 211, 801)).toBeLessThan(0);
  });

  it("表示領域の右端・下端では正方向へ進む", () => {
    expect(exportEdgeVelocity(795, 211, 801)).toBeGreaterThan(0);
  });

  it("中央付近ではスクロールしない", () => {
    expect(exportEdgeVelocity(500, 211, 801)).toBe(0);
  });
});

describe("exportBodySlices", () => {
  const rows = [
    { top: 108, bottom: 220, routeId: "yokooji" },
    { top: 220, bottom: 332, routeId: "yokooji" },
    { top: 332, bottom: 444, routeId: "yokooji" },
    { top: 488, bottom: 600, routeId: "mibu" },
  ];
  const headers = [
    { routeId: "yokooji", top: 64, bottom: 108 },
    { routeId: "mibu", top: 444, bottom: 488 },
  ];

  it("途中の担当枠だけを選んでも所属コース見出しを先頭に付ける", () => {
    expect(exportBodySlices(rows, headers, 220, 332)).toEqual([
      { top: 64, bottom: 108, routeId: "yokooji", kind: "route" },
      { top: 220, bottom: 332, routeId: "yokooji", kind: "row" },
    ]);
  });

  it("複数コースをまたぐ選択では各コース見出しを一度ずつ付ける", () => {
    expect(exportBodySlices(rows, headers, 332, 600)).toEqual([
      { top: 64, bottom: 108, routeId: "yokooji", kind: "route" },
      { top: 332, bottom: 444, routeId: "yokooji", kind: "row" },
      { top: 444, bottom: 488, routeId: "mibu", kind: "route" },
      { top: 488, bottom: 600, routeId: "mibu", kind: "row" },
    ]);
  });
});
