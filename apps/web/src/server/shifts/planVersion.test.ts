import { describe, expect, it } from "vitest";
import { EMPTY_PLAN_VERSION, effectiveTime, planVersionOf, type PlanAssignment } from "./planVersion";

const assignment = (over: Partial<PlanAssignment> = {}): PlanAssignment => ({
  courseId: "c1",
  cycleNo: 1,
  meetingPlace: "豊中センター",
  meetingTime: "07:00",
  arrivalTime: "08:00",
  endTime: "17:00",
  ...over,
});

describe("planVersionOf", () => {
  it("同じ内容なら並び順が違っても同じ版", () => {
    const a = planVersionOf("2026-09-21", [assignment(), assignment({ cycleNo: 2 })]);
    const b = planVersionOf("2026-09-21", [assignment({ cycleNo: 2 }), assignment()]);
    expect(a).toBe(b);
  });

  it("集合時刻・コース・便・日付が変われば別の版になる", () => {
    const base = planVersionOf("2026-09-21", [assignment()]);
    expect(planVersionOf("2026-09-21", [assignment({ meetingTime: "06:30" })])).not.toBe(base);
    expect(planVersionOf("2026-09-21", [assignment({ courseId: "c2" })])).not.toBe(base);
    expect(planVersionOf("2026-09-21", [assignment({ cycleNo: 2 })])).not.toBe(base);
    expect(planVersionOf("2026-09-22", [assignment()])).not.toBe(base);
  });

  it("前後の空白だけの違いでは版を変えない", () => {
    expect(planVersionOf("2026-09-21", [assignment({ meetingPlace: " 豊中センター " })]))
      .toBe(planVersionOf("2026-09-21", [assignment()]));
  });

  it("予定が無い日は決まった版になる", () => {
    expect(planVersionOf("2026-09-21", [])).toBe(EMPTY_PLAN_VERSION);
  });
});

describe("effectiveTime", () => {
  it("シフト → 便 → コース の順に使う。空文字は値として尊重する", () => {
    expect(effectiveTime("07:10", "07:00", "06:50")).toBe("07:10");
    expect(effectiveTime(null, "07:00", "06:50")).toBe("07:00");
    expect(effectiveTime(null, null, "06:50")).toBe("06:50");
    expect(effectiveTime(null, null, null)).toBeNull();
    expect(effectiveTime("", "07:00", "06:50")).toBe("");
  });
});
