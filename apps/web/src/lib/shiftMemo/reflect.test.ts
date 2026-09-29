import { describe, expect, it } from "vitest";
import { buildReflectGroups, laneCourseDefault, laneCycleDefault } from "./reflect";

const course = { id: "course", name: "豊中", uses_cycles: true, course_cycles: [{ cycle_no: 1, active: true }, { cycle_no: 2, active: true }, { cycle_no: 3, active: false }] };
const lane = { id: "base-course-1", routeId: "course", name: "C1", activeWeekdays: [1, 2, 3, 4, 5, 6] };
const person = { personKey: "one", driverId: "one", name: "佐藤" };
const base = { dates: ["2026-09-16", "2026-09-17"], lanes: [lane], courses: [course], selectedLaneIds: [lane.id], assignments: { [`${lane.id}|2026-09-16`]: [person] }, dayOverrides: {}, laneCycles: { [lane.id]: "1" }, personMappings: {}, driverIds: ["one", "two"], includeEmpty: false };
describe("個人メモから反映対象の作成", () => {
  it("旧担当枠の便はIDで復元し、独自枠の便は推測しない", () => {
    expect(laneCycleDefault(lane, course)).toBe("1");
    expect(laneCycleDefault({ ...lane, id: "custom" }, course)).toBe("");
  });
  it("選択日・枠だけを取り込み、空白日は既定で触らない", () => {
    expect(buildReflectGroups(base)).toEqual({ groups: [{ date: "2026-09-16", courseId: "course", cycleNo: 1, driverIds: ["one"] }], errors: [] });
    expect(buildReflectGroups({ ...base, selectedLaneIds: [] }).groups).toEqual([]);
    expect(buildReflectGroups({ ...base, dates: ["2026-09-17"] }).groups).toEqual([]);
    expect(buildReflectGroups({ ...base, includeEmpty: true }).groups[1].driverIds).toEqual([]);
  });
  it("全便への反映は有効なC1/C2だけ。複数担当枠の同じ人は便ごとに1人と数える", () => {
    const other = { ...lane, id: "custom" };
    const result = buildReflectGroups({ ...base, lanes: [lane, other], selectedLaneIds: [lane.id, other.id], laneCycles: { [lane.id]: "all", custom: "all" }, assignments: { ...base.assignments, "custom|2026-09-16": [person, { personKey: "two", driverId: "two", name: "田中" }] } });
    expect(result.groups.map(g => [g.cycleNo, g.driverIds])).toEqual([[1, ["one", "two"]], [2, ["one", "two"]]]);
    expect(result.errors).toEqual([]);
  });
  it("未登録の名前札はメモだけに残し、明示した登録ドライバーだけ反映する", () => {
    const assignments = { [`${lane.id}|2026-09-16`]: [{ personKey: "custom:応援", name: "応援" }] };
    expect(buildReflectGroups({ ...base, assignments })).toEqual({ groups: [], errors: [] });
    expect(buildReflectGroups({ ...base, assignments, personMappings: { "custom:応援": "two" } }).groups[0].driverIds).toEqual(["two"]);
    expect(buildReflectGroups({ ...base, assignments, personMappings: { "custom:応援": "unknown" } }).groups).toEqual([]);
  });
  it("自作枠は親と異なるコースへ反映でき、曖昧なら選択を要求する", () => {
    const other = { id: "other", name: "第二区域", uses_cycles: false };
    const custom = { ...lane, id: "custom", name: "第二区域", custom: true };
    expect(laneCourseDefault(custom, [course, other])).toBe("other");
    expect(laneCourseDefault({ ...custom, name: "補助枠" }, [course, other])).toBe("");
    expect(buildReflectGroups({ ...base, lanes: [custom], courses: [course, other], selectedLaneIds: ["custom"],
      assignments: { "custom|2026-09-16": [person] }, laneCourseIds: { custom: "other" }, laneCycles: { custom: "0" } }).groups[0].courseId).toBe("other");
  });
  it("休みの日に残った札を黙って消さず、メモの修正を求める", () => {
    const result = buildReflectGroups({ ...base, includeEmpty: true, dayOverrides: { [`${lane.id}|2026-09-16`]: "off" } });
    expect(result.errors[0]).toContain("休みの日に配置があります");
    expect(result.groups.some(g => g.date === "2026-09-16")).toBe(false);
  });
  it("便未選択・無効な便を拒否する", () => {
    for (const cycle of ["", "3", "bad"]) expect(buildReflectGroups({ ...base, laneCycles: { [lane.id]: cycle } }).errors).toHaveLength(1);
  });
});
