import { describe, expect, it } from "vitest";
import { canAutoAdvancePhoto, captureLenses, photoAssessmentMessage } from "../src/capture/camera-options";

describe("撮影カメラの機能選択", () => {
  it("列挙された日本語/英語の物理レンズだけを選ぶ", () => {
    expect(captureLenses(["デュアル広角カメラ", "超広角カメラ", "広角カメラ"])).toEqual({ ultra: "超広角カメラ", standard: "広角カメラ" });
    expect(captureLenses(["Back Triple Camera", "Back Ultra Wide Camera", "Back Wide Camera"])).toEqual({ ultra: "Back Ultra Wide Camera", standard: "Back Wide Camera" });
  });
  it("未知の名称・広角非対応で架空のレンズを指定しない", () => {
    expect(captureLenses([])).toEqual({ ultra: undefined, standard: undefined });
    expect(captureLenses(["Back Wide Camera"]).ultra).toBeUndefined();
    expect(captureLenses(["不明なカメラ"]).ultra).toBeUndefined();
  });
  it("解析なしを合格表示にせず、指摘のある写真にだけ再撮影を促す", () => {
    expect(photoAssessmentMessage(null)).toBeNull();
    expect(photoAssessmentMessage({ blur: true })).toContain("ぶれている可能性");
    expect(photoAssessmentMessage({ framing: true })).toContain("車体が切れている可能性");
  });
  it("自動進行は明示的な合格かつ警告なしの写真に限る", () => {
    expect(canAutoAdvancePhoto(null)).toBe(false);
    expect(canAutoAdvancePhoto({})).toBe(false);
    expect(canAutoAdvancePhoto({ passed: true, glare: true })).toBe(false);
    expect(canAutoAdvancePhoto({ passed: true })).toBe(true);
  });
});
