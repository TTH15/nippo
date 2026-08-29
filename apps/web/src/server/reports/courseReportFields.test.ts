import { describe, expect, it } from "vitest";
import { loadCourseReportFields } from "./courseReportFields";

/** course_report_fields だけを返す最小のスタブ */
const stub = (rows: { course_id: string; cycle_no: number; unit_id: string; field_key: string }[]) => ({
  from: () => ({
    select: () => ({ in: async () => ({ data: rows }) }),
  }),
}) as never;

const AM = ["am_mochidashi", "am_completed"];
const PM = ["pm_mochidashi", "pm_completed"];
const FOUR = ["four_mochidashi", "four_completed"];

describe("loadCourseReportFields", () => {
  it("設定が無いコースは全項目を使う", async () => {
    const filter = await loadCourseReportFields(stub([]), ["c1"]);
    expect(filter.hasFilter("c1", 0)).toBe(false);
    for (const f of [...AM, ...PM, ...FOUR]) {
      expect(filter.allows("c1", 0, "u1", f)).toBe(true);
    }
  });

  it("便ごとに使う項目を分けられる（C1は午前・C2は午後）", async () => {
    const rows = [
      ...AM.map((field_key) => ({ course_id: "c1", cycle_no: 1, unit_id: "u1", field_key })),
      ...PM.map((field_key) => ({ course_id: "c1", cycle_no: 2, unit_id: "u1", field_key })),
    ];
    const filter = await loadCourseReportFields(stub(rows), ["c1"]);
    expect(filter.allows("c1", 1, "u1", "am_completed")).toBe(true);
    expect(filter.allows("c1", 1, "u1", "pm_completed")).toBe(false);
    expect(filter.allows("c1", 2, "u1", "pm_completed")).toBe(true);
    expect(filter.allows("c1", 2, "u1", "am_completed")).toBe(false);
    // 4便はどちらの便でも使わない
    expect(filter.allows("c1", 1, "u1", "four_completed")).toBe(false);
    expect(filter.allows("c1", 2, "u1", "four_completed")).toBe(false);
  });

  it("便別の設定が無い便は、コース共通(cycle_no=0)へフォールバックする", async () => {
    const rows = [...AM, ...PM].map((field_key) => ({ course_id: "c1", cycle_no: 0, unit_id: "u1", field_key }));
    const filter = await loadCourseReportFields(stub(rows), ["c1"]);
    // 旧 cycle_no=0 の日報も、便別日報も同じ設定で絞られる
    expect(filter.allows("c1", 0, "u1", "am_completed")).toBe(true);
    expect(filter.allows("c1", 3, "u1", "pm_completed")).toBe(true);
    expect(filter.allows("c1", 3, "u1", "four_completed")).toBe(false);
  });

  it("サイクルを使わないコースでも不要な項目を隠せる（4便だけ使う）", async () => {
    const rows = FOUR.map((field_key) => ({ course_id: "midnight", cycle_no: 0, unit_id: "u1", field_key }));
    const filter = await loadCourseReportFields(stub(rows), ["midnight"]);
    expect(filter.allows("midnight", 0, "u1", "four_completed")).toBe(true);
    expect(filter.allows("midnight", 0, "u1", "am_completed")).toBe(false);
  });

  it("設定のあるコースと無いコースが混在しても互いに影響しない", async () => {
    const rows = AM.map((field_key) => ({ course_id: "c1", cycle_no: 1, unit_id: "u1", field_key }));
    const filter = await loadCourseReportFields(stub(rows), ["c1", "c2"]);
    expect(filter.allows("c1", 1, "u1", "pm_completed")).toBe(false);
    expect(filter.allows("c2", 1, "u1", "pm_completed")).toBe(true);
  });

  it("コース不明の日報は絞り込まない", async () => {
    const rows = AM.map((field_key) => ({ course_id: "c1", cycle_no: 1, unit_id: "u1", field_key }));
    const filter = await loadCourseReportFields(stub(rows), ["c1"]);
    expect(filter.allows(null, 1, "u1", "pm_completed")).toBe(true);
  });
});
