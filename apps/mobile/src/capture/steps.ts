export type CaptureStep = "qr" | "safety" | "license" | "meter" | "inspection";

// 開始時はメーター、退勤時は点検写真。終了メーターは駐車時に撮る。
export function workCaptureSteps(target: "in" | "out", inspection: boolean, safety: "safety" | "license" = "safety"): CaptureStep[] {
  return ["qr", ...(target === "in" ? [safety] : []), ...(inspection ? ["inspection" as const] : []), ...(target === "in" ? ["meter" as const] : [])];
}
