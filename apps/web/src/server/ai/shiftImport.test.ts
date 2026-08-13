import { describe, expect, it } from "vitest";
import { parseDayEntry } from "./shiftImport";

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
