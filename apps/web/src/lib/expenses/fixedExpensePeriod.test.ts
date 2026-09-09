import { describe, expect, it } from "vitest";
import { endOfMonthDate, looksLikeLease, monthKey, monthOf, monthValue } from "./fixedExpensePeriod";

describe("endOfMonthDate", () => {
  it("31日・30日・2月・うるう年をそれぞれ正しく返す", () => {
    expect(endOfMonthDate("2026-01")).toBe("2026-01-31");
    expect(endOfMonthDate("2026-04")).toBe("2026-04-30");
    expect(endOfMonthDate("2026-02")).toBe("2026-02-28");
    expect(endOfMonthDate("2028-02")).toBe("2028-02-29");
    expect(endOfMonthDate("2026-12")).toBe("2026-12-31");
  });
  it("形が違うものは null（誤って保存しない）", () => {
    for (const v of ["", "2026", "2026-13", "2026-00", "2026-1", "2026-01-31", "去年"]) {
      expect(endOfMonthDate(v)).toBeNull();
    }
  });
});

describe("monthOf", () => {
  it("保存済みの日付を月に戻す。空・不正は空文字", () => {
    expect(monthOf("2026-07-31")).toBe("2026-07");
    expect(monthOf(null)).toBe("");
    expect(monthOf("")).toBe("");
    expect(monthOf("2026-13-01")).toBe("");
  });
});

describe("looksLikeLease", () => {
  it("リースを含む名前だけ拾う", () => {
    expect(looksLikeLease("リース代")).toBe(true);
    expect(looksLikeLease("車両リース")).toBe(true);
    expect(looksLikeLease("事務手数料")).toBe(false);
    expect(looksLikeLease("")).toBe(false);
  });
});

describe("monthValue / monthKey", () => {
  it("保存済みの日付とピッカーの値を行き来できる", () => {
    expect(monthValue("2026-07-31")).toEqual({ year: 2026, month: 7 });
    expect(monthValue(null)).toBeUndefined();
    expect(monthValue("")).toBeUndefined();
    expect(monthKey({ year: 2026, month: 7 })).toBe("2026-07");
    expect(monthKey({ year: 2026, month: 12 })).toBe("2026-12");
  });
  it("往復しても値が変わらない", () => {
    for (const m of ["2026-01", "2026-02", "2028-02", "2026-12"]) {
      expect(monthKey(monthValue(endOfMonthDate(m))!)).toBe(m);
    }
  });
});
