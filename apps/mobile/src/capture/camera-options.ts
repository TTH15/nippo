import type { LensInfo } from "expo-camera";

// SDK58は表示名と安定した識別子を分けて返す。選択には列挙されたdeviceTypeだけを使う。
export function captureLenses(lenses: LensInfo[]) {
  const types = new Set(lenses.map(lens => lens.deviceType));
  const ultra = "AVCaptureDeviceTypeBuiltInUltraWideCamera";
  const standard = "AVCaptureDeviceTypeBuiltInWideAngleCamera";
  return { ultra: types.has(ultra) ? ultra : undefined, standard: types.has(standard) ? standard : undefined };
}
export type PhotoAssessment = { blur?: boolean; framing?: boolean; glare?: boolean; passed?: boolean };
// 省略された値や警告なしだけでは合格としない。判定器が明示的に合格を返した場合だけ進める。
export function canAutoAdvancePhoto(value: PhotoAssessment | null) {
  return value?.passed === true && !value.blur && !value.framing && !value.glare;
}
export function photoAssessmentMessage(value: PhotoAssessment | null) {
  if (value?.glare) return "光が反射しています。フラッシュを切り、角度を変えて撮り直してください。";
  if (value?.framing) return "車体が切れている可能性があります。全体を入れて撮り直してください。";
  if (value?.blur) return "写真がぶれている可能性があります。スマホを止めて撮り直してください。";
  return null;
}
