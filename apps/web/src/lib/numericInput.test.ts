import { describe, expect, it } from "vitest";
import { normalizeDecimalText, normalizeDigitText } from "./numericInput";

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

describe("normalizeDecimalText", () => {
  it("小数点を1つだけ残し、小数第2位までに切り詰める", () => {
    expect(normalizeDecimalText("157.5")).toBe("157.5");
    expect(normalizeDecimalText("157.567")).toBe("157.56");
    expect(normalizeDecimalText("157.5.25")).toBe("157.52");
  });

  it("全角の数字・ピリオド・句点を半角小数へ寄せる", () => {
    expect(normalizeDecimalText("１５７．５")).toBe("157.5");
    expect(normalizeDecimalText("157。5")).toBe("157.5");
  });

  it("入力途中の末尾の小数点は保つ", () => {
    expect(normalizeDecimalText("157.")).toBe("157.");
  });

  it("小数桁0なら整数へ丸める（小数部を捨てる）", () => {
    expect(normalizeDecimalText("157.5", 0)).toBe("157");
  });

  it("桁区切りや金額記号を除去する", () => {
    expect(normalizeDecimalText("￥1,234.5円")).toBe("1234.5");
  });
});
