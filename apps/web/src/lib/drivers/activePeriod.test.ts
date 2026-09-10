import { describe, expect, it } from "vitest";
import { isActiveInMonth } from "./activePeriod";

describe("isActiveInMonth", () => {
  const d = { active_from_month: "2026-02", active_until_month: "2026-08" };

  it("開始月と終了月の間なら稼働中（境界の月も含む）", () => {
    expect(isActiveInMonth(d, "2026-02")).toBe(true);
    expect(isActiveInMonth(d, "2026-05")).toBe(true);
    expect(isActiveInMonth(d, "2026-08")).toBe(true);
  });

  it("開始前・終了後は稼働していない", () => {
    expect(isActiveInMonth(d, "2026-01")).toBe(false);
    expect(isActiveInMonth(d, "2026-09")).toBe(false);
    expect(isActiveInMonth(d, "2025-12")).toBe(false);
  });

  it("年をまたいでも月の文字列比較で正しい", () => {
    expect(isActiveInMonth({ active_from_month: "2025-11", active_until_month: null }, "2026-01")).toBe(true);
    expect(isActiveInMonth({ active_from_month: "2026-01", active_until_month: null }, "2025-11")).toBe(false);
  });

  it("開始月なし・終了月なしは在籍とみなす（未入力の人が実在する）", () => {
    expect(isActiveInMonth({}, "2026-09")).toBe(true);
    expect(isActiveInMonth({ active_from_month: null, active_until_month: "2026-08" }, "2020-01")).toBe(true);
    expect(isActiveInMonth({ active_from_month: "2026-09", active_until_month: null }, "2030-12")).toBe(true);
  });

  it("形が壊れている値は無視する", () => {
    expect(isActiveInMonth({ active_from_month: "2026-13", active_until_month: "" }, "2026-01")).toBe(true);
    expect(isActiveInMonth({ active_from_month: "2026-02" }, "こわれた月")).toBe(true);
  });
});
