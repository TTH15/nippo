import { describe, it, expect } from "vitest";
import { buildGoogleCalendarUrl } from "./calendarLink";

// 「カレンダーに追加」は本人の予定表に直接書き込まれるため、
// 時刻がずれる・日付がまたがるといった間違いをここで止める。

function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("buildGoogleCalendarUrl", () => {
  const base = {
    title: "Aコース",
    date: "2026-07-21",
    startTime: "08:00",
    endTime: "17:00",
  };

  it("開始・終了のある予定", () => {
    const url = buildGoogleCalendarUrl(base);
    const p = paramsOf(url!);
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("text")).toBe("Aコース");
    expect(p.get("dates")).toBe("20260721T080000/20260721T170000");
    // タイムゾーンを明示しないと端末の設定でずれる
    expect(p.get("ctz")).toBe("Asia/Tokyo");
  });

  it("終了時刻が無いときは既定の長さで埋める", () => {
    const p = paramsOf(buildGoogleCalendarUrl({ ...base, endTime: null })!);
    expect(p.get("dates")).toBe("20260721T080000/20260721T160000");
  });

  it("終了が開始以前なら日をまたぐ勤務として翌日に送る", () => {
    const p = paramsOf(buildGoogleCalendarUrl({ ...base, startTime: "22:00", endTime: "05:00" })!);
    expect(p.get("dates")).toBe("20260721T220000/20260722T050000");
  });

  it("月末をまたいでも翌日が正しい", () => {
    const p = paramsOf(
      buildGoogleCalendarUrl({ ...base, date: "2026-07-31", startTime: "23:00", endTime: "06:00" })!,
    );
    expect(p.get("dates")).toBe("20260731T230000/20260801T060000");
  });

  it("開始時刻が無ければ終日予定（終了日は翌日＝排他的）", () => {
    const p = paramsOf(buildGoogleCalendarUrl({ ...base, startTime: null })!);
    expect(p.get("dates")).toBe("20260721/20260722");
  });

  it("秒付きの time 型もそのまま渡せる", () => {
    const p = paramsOf(buildGoogleCalendarUrl({ ...base, startTime: "08:00:00" })!);
    expect(p.get("dates")).toBe("20260721T080000/20260721T170000");
  });

  it("場所・詳細は任意（空なら付けない）", () => {
    const withPlace = paramsOf(buildGoogleCalendarUrl({ ...base, location: "本社倉庫" })!);
    expect(withPlace.get("location")).toBe("本社倉庫");
    expect(paramsOf(buildGoogleCalendarUrl(base)!).has("location")).toBe(false);
  });

  it("記号を含む値もエスケープされて壊れない", () => {
    const url = buildGoogleCalendarUrl({ ...base, title: "A&B コース", location: "本社 1F/裏口" })!;
    const p = paramsOf(url);
    expect(p.get("text")).toBe("A&B コース");
    expect(p.get("location")).toBe("本社 1F/裏口");
  });

  it("日付が壊れていたら null（リンクを出さない）", () => {
    expect(buildGoogleCalendarUrl({ ...base, date: "2026/07/21" })).toBeNull();
  });
});
