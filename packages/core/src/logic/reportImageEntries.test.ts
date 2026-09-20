import { describe, expect, it } from "vitest";
import { applyImageEntries } from "./reportImageEntries";

describe("画像から読んだ件数をフォームへ入れる", () => {
  const unit = (id: string, fields: string[]) => ({
    id,
    name: id,
    code: null,
    billingType: "PER_PIECE" as const,
    fields: fields.map((fieldKey) => ({
      fieldKey,
      label: fieldKey,
      inputType: "INT" as const,
      groupLabel: null,
      required: false,
    })),
  });
  const shift = (courseId: string, cycleNo: number, units: ReturnType<typeof unit>[]) => ({
    courseId,
    cycleNo,
    courseName: courseId,
    color: null,
    carrierId: "carrier",
    carrierName: "ヤマト",
    units,
    existing: null,
  });

  it("その報告単位を持つシフトへ入れる", () => {
    const shifts = [shift("course-a", 0, [unit("unit-1", ["completed", "returned"])])];
    const result = applyImageEntries({}, shifts, [
      { unitId: "unit-1", fieldKey: "completed", value: 44 },
      { unitId: "unit-1", fieldKey: "returned", value: 2 },
    ]);
    expect(result.applied).toBe(2);
    expect(result.values["course-a"]["unit-1"]).toEqual({ completed: "44", returned: "2" });
  });

  it("行き先が無い項目は入れない（別コースへ取り違えない）", () => {
    const shifts = [shift("course-a", 0, [unit("unit-1", ["completed"])])];
    const result = applyImageEntries({}, shifts, [{ unitId: "unit-9", fieldKey: "completed", value: 10 }]);
    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.values).toEqual({});
  });

  it("既に入っている値を消さずに上書きする", () => {
    const shifts = [shift("course-a", 1, [unit("unit-1", ["completed", "returned"])])];
    const before = { "course-a:1": { "unit-1": { returned: "5" } } };
    const result = applyImageEntries(before, shifts, [{ unitId: "unit-1", fieldKey: "completed", value: 44 }]);
    expect(result.values["course-a:1"]["unit-1"]).toEqual({ returned: "5", completed: "44" });
  });
});
