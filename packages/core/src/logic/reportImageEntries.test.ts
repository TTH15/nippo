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
  it("同じ項目を持つ複数コースでは、先頭へ入れず反映先の指定を要求する", () => {
    const shifts = [shift("a",1,[unit("u",["done"])]),shift("b",1,[unit("u",["done"])])];
    const result = applyImageEntries({},shifts,[{ unitId:"u",fieldKey:"done",value:42 }]);
    expect(result.applied).toBe(0);expect(result.skipped).toHaveLength(1);expect(result.values).toEqual({});
    expect(applyImageEntries({},shifts,[{ unitId:"u",fieldKey:"done",value:42,targetFormKey:"b:1" }]).values).toEqual({ "b:1":{u:{done:"42"}} });
  });
  it("再読取は選んだ便・項目だけを置き換え、他便と元データを保持する", () => {
    const shifts = [shift("a",1,[unit("u",["done","back"])]),shift("a",2,[unit("u",["done","back"])])];
    const before = {"a:1":{u:{done:"71",back:"2"}},"a:2":{u:{done:"47",back:"3"}}};
    const result = applyImageEntries(before,shifts,[{unitId:"u",fieldKey:"done",value:72,targetFormKey:"a:1"}]);
    expect(result.values["a:1"].u).toEqual({done:"72",back:"2"});expect(result.values["a:2"]).toEqual(before["a:2"]);
    expect(before["a:1"].u.done).toBe("71");
  });
  it("反映先を指定しても存在しない項目や不正な数量は通さない", () => {
    const shifts = [shift("a",1,[unit("u",["done"])]),shift("b",2,[unit("v",["done"])])];
    const result=applyImageEntries({},shifts,[{unitId:"u",fieldKey:"done",value:8,targetFormKey:"b:2"},{unitId:"u",fieldKey:"done",value:NaN},{unitId:"u",fieldKey:"done",value:-1}]);
    expect(result.applied).toBe(0);expect(result.skipped).toHaveLength(3);
  });

  it("同じ反映先に異なる読取値があれば、後の値を採らず保持する", () => {
    const shifts=[shift("a",1,[unit("u",["done"])])];
    const before={"a:1":{u:{done:"71"}}};
    const result=applyImageEntries(before,shifts,[{unitId:"u",fieldKey:"done",value:72},{unitId:"u",fieldKey:"done",value:82}]);
    expect(result.values).toEqual(before);expect(result.applied).toBe(0);expect(result.skipped).toHaveLength(2);
  });

});
