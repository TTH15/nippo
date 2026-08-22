import { describe, expect, it } from "vitest";
import { normalizeDigitText } from "./numericInput";

describe("normalizeDigitText", () => {
  it("全角数字を半角数字へ変換する", () => {
    expect(normalizeDigitText("１２３４５６７８９０")).toBe("1234567890");
  });

  it("半角数字と全角数字が混在しても入力順を保つ", () => {
    expect(normalizeDigitText("12３４5")).toBe("12345");
  });

  it("桁区切りや金額記号を除去する", () => {
    expect(normalizeDigitText("￥１２,３４５円")).toBe("12345");
  });

  it("数字がなければ空文字列を返す", () => {
    expect(normalizeDigitText("金額")).toBe("");
  });
});
