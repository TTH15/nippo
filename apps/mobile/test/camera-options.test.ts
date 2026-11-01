import { describe, expect, it } from "vitest";
import { canAutoAdvancePhoto, captureLenses, photoAssessmentMessage } from "../src/capture/camera-options";

describe("撮影カメラの機能選択", () => {
  it("表示言語に依存せず、列挙された物理レンズの識別子を選ぶ", () => {
    const lenses = [
      { deviceType: "AVCaptureDeviceTypeBuiltInTripleCamera", localizedName: "トリプルカメラ" },
      { deviceType: "AVCaptureDeviceTypeBuiltInUltraWideCamera", localizedName: "超広角カメラ" },
      { deviceType: "AVCaptureDeviceTypeBuiltInWideAngleCamera", localizedName: "Back Wide Camera" },
    ];
    expect(captureLenses(lenses)).toEqual({ ultra: lenses[1].deviceType, standard: lenses[2].deviceType });
    expect(captureLenses(lenses.map(lens => ({ ...lens, localizedName: "別の言語" })))).toEqual(captureLenses(lenses));
  });
  it("非対応端末・未知のレンズで架空の識別子を指定しない", () => {
    expect(captureLenses([])).toEqual({ ultra: undefined, standard: undefined });
    expect(captureLenses([{ deviceType: "AVCaptureDeviceTypeBuiltInWideAngleCamera", localizedName: "広角" }]).ultra).toBeUndefined();
    expect(captureLenses([{ deviceType: "unknown", localizedName: "Back Ultra Wide Camera" }])).toEqual({ ultra: undefined, standard: undefined });
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
