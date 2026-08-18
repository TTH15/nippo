import { describe, it, expect } from "vitest";
import {
  formatDateJa,
  getMonthRange,
  nextMonthEndDate,
  normalizeSection,
  periodForMonth,
  sumDraftTotal,
} from "./invoiceDraft";

describe("getMonthRange", () => {
  it("うるう年2月の末日を返す", () => {
    expect(getMonthRange("2024-02")).toEqual({
      month: "2024-02",
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });
  });
  it("書式が不正なら当月にフォールバックする", () => {
    const r = getMonthRange("2026/08");
    expect(r.month).toMatch(/^\d{4}-\d{2}$/);
    expect(r.startDate.endsWith("-01")).toBe(true);
  });
});

describe("nextMonthEndDate", () => {
  it("翌月末（年跨ぎ）", () => {
    expect(nextMonthEndDate("2025-12")).toBe("2026-01-31");
  });
  it("翌月末（2月）", () => {
    expect(nextMonthEndDate("2026-01")).toBe("2026-02-28");
  });
});

describe("periodForMonth / formatDateJa", () => {
  it("対象期間は月初〜月末", () => {
    expect(periodForMonth("2026-08")).toBe("2026年8月1日〜2026年8月31日");
  });
  it("ISO日付を和暦表記に（DatePickerが読めるISOで保存し、表示だけ変換する）", () => {
    expect(formatDateJa("2026-09-30")).toBe("2026年9月30日");
  });
  it("ISO以外はそのまま返す", () => {
    expect(formatDateJa("2026年9月30日")).toBe("2026年9月30日");
  });
});

describe("normalizeSection", () => {
  it("既知の区分はそのまま", () => {
    expect(normalizeSection("Amazon")).toBe("Amazon");
    expect(normalizeSection("郵便局")).toBe("郵便局");
  });
  it("不明な値はヤマト運輸へ寄せる", () => {
    expect(normalizeSection("なにか")).toBe("ヤマト運輸");
    expect(normalizeSection(undefined)).toBe("ヤマト運輸");
  });
});

describe("sumDraftTotal", () => {
  it("請求分 − お支払い分（税は含めない）", () => {
    expect(
      sumDraftTotal({
        main: [
          { title: "配送", qty: 20, price: 15000 },
          { title: "手当", qty: 1, price: 5000 },
        ],
        deduct: [{ title: "リース代", qty: 1, price: 39091 }],
      }),
    ).toBe(20 * 15000 + 5000 - 39091);
  });
  it("明細が空なら0", () => {
    expect(sumDraftTotal({ main: [], deduct: [] })).toBe(0);
  });
});
