import { describe, expect, it } from "vitest";
import { parseLicenseExpiry } from "./parseLicenseExpiry";

// baseYear を固定してテストの経年劣化を防ぐ（2026 想定）。
const BASE = 2026;

describe("parseLicenseExpiry", () => {
  it("西暦表記を読む", () => {
    expect(parseLicenseExpiry("2028年08月22日まで有効", BASE)).toBe("2028-08-22");
  });

  it("令和表記を読む", () => {
    expect(parseLicenseExpiry("令和10年08月22日まで有効", BASE)).toBe("2028-08-22");
  });

  it("令和元年を読む", () => {
    expect(parseLicenseExpiry("令和元年12月01日まで有効", 2019)).toBe("2019-12-01");
  });

  it("平成表記を読む（当時の基準年）", () => {
    expect(parseLicenseExpiry("平成30年08月31日まで有効", 2018)).toBe("2018-08-31");
  });

  it("全角数字・空白・改行の OCR ゆらぎを吸収する", () => {
    expect(parseLicenseExpiry("２０２８年 ０８月\n２２日 まで有効", BASE)).toBe("2028-08-22");
  });

  it("交付日や生年月日より「まで」付きの有効期限を優先する", () => {
    const text = "昭和63年01月22日生 交付2026年07月01日 12345 2028年08月22日まで有効";
    expect(parseLicenseExpiry(text, BASE)).toBe("2028-08-22");
  });

  it("「まで」が読めなかった場合は最も未来の日付を選ぶ", () => {
    const text = "交付2026年07月01日 2028年08月22日";
    expect(parseLicenseExpiry(text, BASE)).toBe("2028-08-22");
  });

  it("範囲外の年（生年月日など）は候補にしない", () => {
    expect(parseLicenseExpiry("1990年01月22日", BASE)).toBeNull();
    expect(parseLicenseExpiry("2045年01月22日まで有効", BASE)).toBeNull();
  });

  it("実在しない日付は候補にしない", () => {
    expect(parseLicenseExpiry("2028年13月01日まで有効", BASE)).toBeNull();
    expect(parseLicenseExpiry("2027年02月29日まで有効", BASE)).toBeNull();
  });

  it("日付が無ければ null", () => {
    expect(parseLicenseExpiry("運転免許証 公安委員会", BASE)).toBeNull();
  });
});
