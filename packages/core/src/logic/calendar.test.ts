import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getDaysInMonth,
  monthDateRange,
  toLocalDateStr,
  toLocalTimeStr,
  formatYearMonth,
  formatMonthDayJP,
  formatMonthDayWeekdayJP,
  formatDateSlashWeekdayJP,
  reportDateDefaultJST,
} from "./calendar";

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

describe("formatMonthDayWeekdayJP", () => {
  it("曜日を添える（通知で出勤日か休みかを読み違えないため）", () => {
    expect(formatMonthDayWeekdayJP("2026-07-21")).toBe("7月21日(火)");
    expect(formatMonthDayWeekdayJP("2026-07-20")).toBe("7月20日(月)");
    expect(formatMonthDayWeekdayJP("2026-07-19")).toBe("7月19日(日)");
  });

  it("月初・年またぎでも曜日がずれない", () => {
    expect(formatMonthDayWeekdayJP("2026-01-01")).toBe("1月1日(木)");
    expect(formatMonthDayWeekdayJP("2026-12-31")).toBe("12月31日(木)");
  });
});

describe("formatDateSlashWeekdayJP", () => {
  it("年月日をゼロ埋めし、曜日付きのスラッシュ表記にする", () => {
    expect(formatDateSlashWeekdayJP("2026-09-01")).toBe("2026/09/01（火）");
    expect(formatDateSlashWeekdayJP("2026-01-05")).toBe("2026/01/05（月）");
  });
});

describe("reportDateDefaultJST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("午前3時より前は前日の日付を返す（深夜便の送信で日付がズレないこと）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T00:34:00+09:00"));
    expect(reportDateDefaultJST()).toBe("2026-07-05");
  });

  it("午前3時ちょうどは当日の日付を返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T03:00:00+09:00"));
    expect(reportDateDefaultJST()).toBe("2026-07-06");
  });

  it("日中は当日の日付をそのまま返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T19:00:00+09:00"));
    expect(reportDateDefaultJST()).toBe("2026-07-05");
  });
});
