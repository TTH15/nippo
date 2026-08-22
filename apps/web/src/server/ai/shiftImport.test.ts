import { describe, expect, it } from "vitest";
import {
  isReliableFastExtraction,
  parseDayEntry,
  shiftImportFormatKey,
  suggestCycleNo,
  type ExtractedFileResult,
} from "./shiftImport";

// AI 出力の圧縮表現「日:内容」のパース（出力トークン削減の要）
describe("parseDayEntry", () => {
  it("基本形を分解できる", () => {
    expect(parseDayEntry("5:豊中")).toEqual({ day: 5, label: "豊中" });
    expect(parseDayEntry("31:休")).toEqual({ day: 31, label: "休" });
    expect(parseDayEntry("12:〇")).toEqual({ day: 12, label: "〇" });
  });

  it("内容側にコロンが含まれても最初のコロンだけで区切る", () => {
    expect(parseDayEntry("12:9:00〜14:00")).toEqual({ day: 12, label: "9:00〜14:00" });
  });

  it("空の内容（空欄セルが誤って出力された場合）は空文字ラベルになる", () => {
    expect(parseDayEntry("8:")).toEqual({ day: 8, label: "" });
  });

  it("前後の空白は内容から除去する", () => {
    expect(parseDayEntry("3: 上京 ")).toEqual({ day: 3, label: "上京" });
  });

  it("不正な形式は null", () => {
    expect(parseDayEntry("豊中")).toBeNull(); // コロンなし
    expect(parseDayEntry(":豊中")).toBeNull(); // 日が空
    expect(parseDayEntry("0:豊中")).toBeNull(); // 範囲外
    expect(parseDayEntry("32:豊中")).toBeNull(); // 範囲外
    expect(parseDayEntry("abc:豊中")).toBeNull(); // 数字でない
  });
});

describe("shiftImportFormatKey", () => {
  it("年月だけが変わる同じ帳票名を同一形式として扱う", () => {
    expect(shiftImportFormatKey("2026年8月_豊中シフト.pdf", "application/pdf")).toBe(
      shiftImportFormatKey("2026年9月_豊中シフト.pdf", "application/pdf"),
    );
    expect(shiftImportFormatKey("shift_202608.png", "image/png")).toBe(
      shiftImportFormatKey("shift_202609.png", "image/png"),
    );
  });

  it("年月しか情報がない汎用名は誤学習を避ける", () => {
    expect(shiftImportFormatKey("202608.pdf", "application/pdf")).toBeNull();
  });

  it("保存キーへ元のファイル名を残さない", () => {
    const key = shiftImportFormatKey("田中_豊中シフト_2026年8月.pdf", "application/pdf");
    expect(key).not.toContain("田中");
    expect(key).not.toContain("豊中");
  });
});

describe("suggestCycleNo", () => {
  const course = {
    id: "course-1",
    name: "豊中Amazon",
    uses_cycles: true,
    course_cycles: [
      { cycle_no: 1, label: "C1", active: true },
      { cycle_no: 2, label: "C2", active: true },
      { cycle_no: 3, label: "C3", active: false },
    ],
  };

  it("C1・全角C2・2便を有効なサイクル番号へ解決する", () => {
    expect(suggestCycleNo("豊中 C1", course)).toBe(1);
    expect(suggestCycleNo("豊中 Ｃ２", course)).toBe(2);
    expect(suggestCycleNo("第2便", course)).toBe(2);
  });

  it("無効な便とサイクル非使用コースは0へ戻す", () => {
    expect(suggestCycleNo("C3", course)).toBe(0);
    expect(suggestCycleNo("C1", { ...course, uses_cycles: false })).toBe(0);
  });
});

describe("isReliableFastExtraction", () => {
  const result = {
    sourceName: "shift.pdf",
    title: "シフト",
    period: { year: 2026, month: 8 },
    weekdays: [],
    people: [
      { name: "A", days: [{ day: 1, label: "C1" }], total: 1 },
      { name: "B", days: [{ day: 1, label: "休" }], total: 0 },
    ],
    dayTotals: [],
    labelGuesses: [],
    formatProfile: "行が氏名、列が日付",
    warnings: [],
  } satisfies ExtractedFileResult;

  it("氏名・勤務セル・合計検算が成立する結果を高速経路で採用する", () => {
    expect(isReliableFastExtraction(result)).toBe(true);
  });

  it("人も勤務セルもない結果は通常解析へ戻す", () => {
    expect(isReliableFastExtraction({ ...result, people: [] })).toBe(false);
    expect(
      isReliableFastExtraction({
        ...result,
        people: [{ name: "A", days: [{ day: 1, label: "" }], total: null }],
      }),
    ).toBe(false);
  });
});
