import { describe, it, expect } from "vitest";
import { daysUntil, upcomingDeadline, type DeadlineRule } from "./shiftDeadline";

describe("daysUntil", () => {
  it("同日は0", () => expect(daysUntil("2026-06-16", "2026-06-16")).toBe(0));
  it("翌日は1", () => expect(daysUntil("2026-06-16", "2026-06-17")).toBe(1));
  it("過去は負", () => expect(daysUntil("2026-06-16", "2026-06-14")).toBe(-2));
  it("月跨ぎ", () => expect(daysUntil("2026-06-28", "2026-07-03")).toBe(5));
  it("年跨ぎ", () => expect(daysUntil("2026-12-30", "2027-01-02")).toBe(3));
});

// 前半(1〜15, 締切=前月23日) / 後半(16〜末, 締切=当月10日) の標準ルール。
const rule: DeadlineRule = {
  id: "r1",
  name: "標準",
  periods: [
    { seq: 1, startDay: 1, endDay: 15, deadlineMonthOffset: -1, deadlineDay: 23 },
    { seq: 2, startDay: 16, endDay: 31, deadlineMonthOffset: 0, deadlineDay: 10 },
  ],
  overrides: [],
};

describe("upcomingDeadline", () => {
  it("ルール未割り当ては null", () => {
    expect(upcomingDeadline(null, "2026-06-16")).toBeNull();
  });

  it("6/16時点では7月前半の締切(6/23)が次の締切", () => {
    // 6月後半の締切(6/10)は既に過ぎている → 次は7月前半の締切 6/23。
    const next = upcomingDeadline(rule, "2026-06-16");
    expect(next?.deadline).toBe("2026-06-23");
  });

  it("6/24時点（6/23締切超過後）では7月後半の締切(7/10)が次", () => {
    const next = upcomingDeadline(rule, "2026-06-24");
    expect(next?.deadline).toBe("2026-07-10");
  });

  it("締切当日(6/23)はまだ未締切（当日含む）として返る", () => {
    const next = upcomingDeadline(rule, "2026-06-23");
    expect(next?.deadline).toBe("2026-06-23");
  });

  it("override があれば最優先で締切が変わる", () => {
    const withOv: DeadlineRule = {
      ...rule,
      overrides: [{ targetYear: 2026, targetMonth: 7, periodSeq: 1, deadlineDate: "2026-06-20" }],
    };
    const next = upcomingDeadline(withOv, "2026-06-16");
    expect(next?.deadline).toBe("2026-06-20");
  });
});
