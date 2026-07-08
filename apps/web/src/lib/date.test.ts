import { describe, it, expect, vi, afterEach } from "vitest";
import { reportDateDefaultJST } from "./date";

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
