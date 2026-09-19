import { describe, it, expect } from "vitest";
import { certificateTextFromWords, parseVehicleCertificate, selectedCertificatePatch, emptyCertificate } from "./vehicleCertificate";
describe("車検証の読取候補", () => {
  it("表の左右列が別ブロックでも、位置を使ってラベルと値を同じ行へ戻す", () => {
    const w = (text: string, x: number, y: number) => ({ text, bbox: { x0: x, x1: x + 80, y0: y, y1: y + 18 } });
    const text = certificateTextFromWords([w("車名", 10, 10), w("型式", 10, 50), w("スズキ", 150, 12), w("HBD-DA17V", 150, 52)]);
    expect(parseVehicleCertificate(text)).toMatchObject({ manufacturer: "スズキ", brand: "エブリイ", modelCode: "HBD-DA17V" });
  });
  it("接頭辞を保持して車種を引き、和暦とナンバーを読む", () => {
    expect(parseVehicleCertificate("車両番号 大阪 ４８０ り １２−３４\n車名 スズキ\n型式 ＨＢＤ−ＤＡ１７Ｖ\n有効期間の満了する日 令和８年１１月２０日")).toEqual({
      numberPrefix: "大阪", numberClass: "480", numberHiragana: "り", numberNumeric: "1234", manufacturer: "スズキ", brand: "エブリイ", modelCode: "HBD-DA17V", nextShakenDate: "2026-11-20",
    });
  });
  it("電子券面の記録年月日を満了日にしない。原動機型式や車台番号から車種を推測しない", () => {
    const r = parseVehicleCertificate("記録年月日 令和8年1月10日 原動機の型式 R06A 車台番号 DA17V-123456 走行距離 65000km");
    expect(r).toEqual(emptyCertificate());
  });
  it("メーカーの矛盾と改造型式では車種を確定しない", () => {
    expect(parseVehicleCertificate("車名ホンダ 型式HBD-DA17V").brand).toBe("");
    expect(parseVehicleCertificate("車名スズキ 型式HBD-DA17V改").brand).toBe("");
  });
  it("無効な日付を候補にしない", () => {
    expect(parseVehicleCertificate("有効期間の満了する日令和8年2月30日").nextShakenDate).toBe("");
    expect(parseVehicleCertificate("有効期間の満了する日2028/2/29").nextShakenDate).toBe("2028-02-29");
  });
  it("選択しなかった項目や読めなかった項目で既存値を消さない", () => {
    const d = { ...emptyCertificate(), modelCode: " DA17V ", numberNumeric: "1234" };
    expect(selectedCertificatePatch(d, ["modelCode", "nextShakenDate"])).toEqual({ modelCode: "DA17V" });
  });
});
