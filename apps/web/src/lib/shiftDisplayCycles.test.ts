import { describe, expect, it } from "vitest";
import { activeCourseCycleNos, displayCourseCycleNos } from "./shiftDisplayCycles";

describe("過去便の表示と現在の編集候補", () => {
  const course = { uses_cycles: true, course_cycles: [{ cycle_no: 1, active: false }, { cycle_no: 2, active: true }] };
  it("無効C1の当日実績を表示し、追加・コピーの候補はC2だけに保つ", () => {
    expect(displayCourseCycleNos(course, [1])).toEqual([2, 1]);
    expect(activeCourseCycleNos(course)).toEqual([2]);
    expect(displayCourseCycleNos(course, [])).toEqual([2]);
  });
  it("便制へ変更前・変更後、便マスタ消失後も実績の番号を残す", () => {
    expect(displayCourseCycleNos(course, [0, 1, 1])).toEqual([0, 2, 1]);
    expect(displayCourseCycleNos({ uses_cycles: false, course_cycles: course.course_cycles }, [1])).toEqual([0, 1]);
    expect(displayCourseCycleNos({ uses_cycles: true, course_cycles: [] }, [3])).toEqual([3]);
  });
});
