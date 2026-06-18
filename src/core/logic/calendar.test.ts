import { describe, it, expect } from "vitest";
import { getDaysInMonth, monthDateRange, toLocalDateStr, toLocalTimeStr, formatYearMonth, formatMonthDayJP } from "./calendar";

describe("getDaysInMonth（month は 0-indexed）", () => {
  it("2026年2月(month=1)は28日", () => {
    const days = getDaysInMonth(2026, 1);
    expect(days).toHaveLength(28);
    expect(toLocalDateStr(days[0])).toBe("2026-02-01");
    expect(toLocalDateStr(days[27])).toBe("2026-02-28");
  });
  it("2026年6月(month=5)は30日", () => {
    expect(getDaysInMonth(2026, 5)).toHaveLength(30);
  });
  it("うるう年2024年2月(month=1)は29日", () => {
    expect(getDaysInMonth(2024, 1)).toHaveLength(29);
  });
});

describe("monthDateRange（month は 1-indexed）", () => {
  it("6月は01〜30", () => {
    expect(monthDateRange(2026, 6)).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("2月は01〜28（ゼロ埋め）", () => {
    expect(monthDateRange(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("toLocalDateStr", () => {
  it("ローカルの年月日をゼロ埋めで返す", () => {
    expect(toLocalDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("toLocalTimeStr", () => {
  it("ローカルの時刻を HH:MM（ゼロ埋め）で返す", () => {
    expect(toLocalTimeStr(new Date(2026, 0, 5, 9, 5))).toBe("09:05");
    expect(toLocalTimeStr(new Date(2026, 0, 5, 23, 59))).toBe("23:59");
  });
});

describe("formatYearMonth（month は 1-indexed）", () => {
  it("月をゼロ埋めして YYYY-MM", () => {
    expect(formatYearMonth(2026, 6)).toBe("2026-06");
    expect(formatYearMonth(2026, 12)).toBe("2026-12");
  });
});

describe("formatMonthDayJP", () => {
  it("ゼロ埋めを外して M月D日", () => {
    expect(formatMonthDayJP("2026-06-05")).toBe("6月5日");
    expect(formatMonthDayJP("2026-12-25")).toBe("12月25日");
  });
});
