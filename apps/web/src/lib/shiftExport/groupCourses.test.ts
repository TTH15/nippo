import { describe, expect, it } from "vitest";
import { groupShiftExportCourses } from "./groupCourses";

const entry = (courseId: string, cycleNo: number, label = "久御山Amazon") => ({
  courseId, cycleNo, label, color: "#f59e0b", activeCycleNos: [1, 2], cycleBadge: `C${cycleNo}`,
});

describe("groupShiftExportCourses", () => {
  it("全便の割当はコースを1枚にまとめ、別コースは別札にする", () => {
    expect(groupShiftExportCourses([entry("a", 1), entry("a", 2), entry("b", 1, "豊中Amazon")]))
      .toMatchObject([{ label: "久御山Amazon" }, { label: "豊中Amazon C1" }]);
  });

  it("片便と重複枠は便名を明示して1枚にする", () => {
    expect(groupShiftExportCourses([entry("a", 2), entry("a", 2)]))
      .toMatchObject([{ label: "久御山Amazon C2" }]);
  });
});
