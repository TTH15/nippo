import { describe, expect, it } from "vitest";
import { datesBetween, driverPlansOf, framesOf, sourceExtractsOf } from "./readinessData";
import { EMPTY_PLAN_VERSION } from "./planVersion";

const course = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "豊中",
  uses_cycles: false,
  archived_at: null,
  meeting_place: "豊中センター",
  meeting_time: "07:00",
  arrival_time: "08:00",
  end_time: "17:00",
  course_cycles: null,
  ...over,
}) as Parameters<typeof framesOf>[0][number];

const shift = (over: Record<string, unknown> = {}) => ({
  shift_date: "2026-09-21",
  course_id: "c1",
  cycle_no: 0,
  driver_id: "d1",
  vehicle_id: null,
  uses_external_vehicle: false,
  meeting_place: null,
  meeting_time: null,
  arrival_time: null,
  end_time: null,
  ...over,
}) as Parameters<typeof driverPlansOf>[0][number];

describe("datesBetween", () => {
  it("両端を含んで昇順", () => {
    expect(datesBetween("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
  it("逆順・不正な日付は空", () => {
    expect(datesBetween("2026-09-05", "2026-09-01")).toEqual([]);
    expect(datesBetween("x", "2026-09-01")).toEqual([]);
  });
});

describe("framesOf", () => {
  it("便を使うコースは有効な便ごと、使わないコースは0の1枠", () => {
    const frames = framesOf([
      course({ id: "c1", uses_cycles: true, course_cycles: [
        { cycle_no: 1, label: "C1", active: true, meeting_place: null, meeting_time: null, arrival_time: null, end_time: null },
        { cycle_no: 2, label: "C2", active: false, meeting_place: null, meeting_time: null, arrival_time: null, end_time: null },
      ] }),
      course({ id: "c2", name: "吹田" }),
    ]);
    expect(frames.map((f) => [f.courseId, f.cycleNo])).toEqual([["c1", 1], ["c2", 0]]);
  });

  it("アーカイブ済みのコースは枠にしない", () => {
    expect(framesOf([course({ archived_at: "2026-01-01" })])).toEqual([]);
  });

  it("便を使う設定でも有効な便が無ければ0の1枠に落とす", () => {
    expect(framesOf([course({ uses_cycles: true, course_cycles: [] })]).map((f) => f.cycleNo)).toEqual([0]);
  });
});

describe("driverPlansOf", () => {
  it("時刻は シフト → 便 → コース の順に解決する", () => {
    const withCourseDefault = driverPlansOf([shift()], [course()]);
    const withShiftOverride = driverPlansOf([shift({ meeting_time: "06:30" })], [course()]);
    expect(withCourseDefault[0].planVersion).not.toBe(withShiftOverride[0].planVersion);
  });

  it("同じ人・同じ日の複数の予定を1つの版にまとめる", () => {
    const plans = driverPlansOf([shift(), shift({ course_id: "c1", cycle_no: 1 })], [course({ uses_cycles: true, course_cycles: [
      { cycle_no: 1, label: "C1", active: true, meeting_place: null, meeting_time: "09:00", arrival_time: null, end_time: null },
    ] })]);
    expect(plans).toHaveLength(1);
    expect(plans[0].planVersion).not.toBe(EMPTY_PLAN_VERSION);
  });

  it("割当のない行（driver_id なし）は版を作らない", () => {
    expect(driverPlansOf([shift({ driver_id: null })], [course()])).toEqual([]);
  });

  it("人ごと・日ごとに別の版になる", () => {
    const plans = driverPlansOf([shift(), shift({ driver_id: "d2" }), shift({ shift_date: "2026-09-22" })], [course()]);
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((p) => p.planVersion)).size).toBe(2); // 同じ日の2人は同じ内容＝同じ版
  });
});

describe("sourceExtractsOf", () => {
  it("読める行だけを取り出す", () => {
    const extracts = sourceExtractsOf([
      { extracted: { rows: [
        { date: "2026-09-21", courseId: "c1", cycleNo: 1, driverIds: ["d1", "d2"] },
        { date: "2026/09/21", courseId: "c1", cycleNo: 1, driverIds: ["d3"] },
        { date: "2026-09-22", courseId: "", cycleNo: 1, driverIds: ["d3"] },
        { date: "2026-09-22", courseId: "c1", cycleNo: 1, driverIds: "d3" },
      ] } },
    ]);
    expect(extracts).toEqual([{ date: "2026-09-21", courseId: "c1", cycleNo: 1, driverIds: ["d1", "d2"] }]);
  });

  it("便が無ければ0として扱い、文字列でないIDは落とす", () => {
    const extracts = sourceExtractsOf([
      { extracted: { rows: [{ date: "2026-09-21", courseId: "c1", driverIds: ["d1", 3, null] }] } },
    ]);
    expect(extracts).toEqual([{ date: "2026-09-21", courseId: "c1", cycleNo: 0, driverIds: ["d1"] }]);
  });

  it("形が違う抽出結果は無視する（古いバッチ・null）", () => {
    expect(sourceExtractsOf([{ extracted: null }, { extracted: { rows: "x" } }, { extracted: {} }])).toEqual([]);
  });
});
