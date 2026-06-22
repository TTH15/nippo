import { describe, it, expect } from "vitest";
import {
  isFormNoticeActiveOn,
  normalizeFormNotice,
  defaultFormNotice,
  type FormNotice,
} from "./config";

const base: FormNotice = {
  enabled: true,
  message: "注意してください",
  startDate: null,
  endDate: null,
};

describe("isFormNoticeActiveOn", () => {
  it("無効なら常に非表示", () => {
    expect(isFormNoticeActiveOn({ ...base, enabled: false }, "2026-06-16")).toBe(false);
  });

  it("メッセージが空白のみなら非表示", () => {
    expect(isFormNoticeActiveOn({ ...base, message: "   " }, "2026-06-16")).toBe(false);
  });

  it("期間未指定なら有効中は常に表示", () => {
    expect(isFormNoticeActiveOn(base, "2000-01-01")).toBe(true);
    expect(isFormNoticeActiveOn(base, "2999-12-31")).toBe(true);
  });

  it("開始日より前は非表示・当日以降は表示", () => {
    const n = { ...base, startDate: "2026-06-16" };
    expect(isFormNoticeActiveOn(n, "2026-06-15")).toBe(false);
    expect(isFormNoticeActiveOn(n, "2026-06-16")).toBe(true);
    expect(isFormNoticeActiveOn(n, "2026-06-17")).toBe(true);
  });

  it("終了日は当日を含み、翌日は非表示", () => {
    const n = { ...base, endDate: "2026-06-16" };
    expect(isFormNoticeActiveOn(n, "2026-06-16")).toBe(true);
    expect(isFormNoticeActiveOn(n, "2026-06-17")).toBe(false);
  });

  it("開始・終了の両方指定（範囲内のみ表示）", () => {
    const n = { ...base, startDate: "2026-06-10", endDate: "2026-06-20" };
    expect(isFormNoticeActiveOn(n, "2026-06-09")).toBe(false);
    expect(isFormNoticeActiveOn(n, "2026-06-10")).toBe(true);
    expect(isFormNoticeActiveOn(n, "2026-06-20")).toBe(true);
    expect(isFormNoticeActiveOn(n, "2026-06-21")).toBe(false);
  });
});

describe("normalizeFormNotice", () => {
  it("未定義・不正値は安全な既定にフォールバック", () => {
    expect(normalizeFormNotice(undefined)).toEqual(defaultFormNotice());
    expect(normalizeFormNotice({ enabled: "yes", message: 123, startDate: "bad", endDate: 5 })).toEqual({
      enabled: false,
      message: "",
      startDate: null,
      endDate: null,
    });
  });

  it("日付は先頭10文字を採用（timestamptz 等の混入に耐性）", () => {
    expect(normalizeFormNotice({ startDate: "2026-06-16T00:00:00Z" }).startDate).toBe("2026-06-16");
  });

  it("正常値はそのまま保持", () => {
    expect(
      normalizeFormNotice({ enabled: true, message: "x", startDate: "2026-06-16", endDate: "2026-06-20" }),
    ).toEqual({ enabled: true, message: "x", startDate: "2026-06-16", endDate: "2026-06-20" });
  });
});
