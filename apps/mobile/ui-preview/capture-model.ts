import { workCaptureSteps } from "../src/capture/steps";

export type PreviewCaptureStep = "qr" | "safety" | "license" | "front" | "right" | "rear" | "left" | "meter" | "review";
export const CAPTURE_LABELS: Record<PreviewCaptureStep, string> = {
  qr: "車両のQR", safety: "免許証の携帯確認", license: "免許証の撮影", front: "車両の前", right: "車両の右", rear: "車両の後", left: "車両の左", meter: "メーターパネル全体", review: "送信内容の確認",
};
export function previewCapturePlan(target: "in" | "out", inspection: boolean): PreviewCaptureStep[] {
  return [...workCaptureSteps(target, inspection).filter(step => target === "in" || step !== "meter").flatMap<PreviewCaptureStep>(step => step === "inspection" ? ["front", "right", "rear", "left"] : [step]), "review"];
}
export type CaptureDraft = { plan: PreviewCaptureStep[]; index: number; completed: PreviewCaptureStep[] };
export const newCaptureDraft = (target: "in" | "out", inspection: boolean): CaptureDraft => ({ plan: previewCapturePlan(target, inspection), index: 0, completed: [] });
export function advanceCapture(draft: CaptureDraft): CaptureDraft {
  const step = draft.plan[draft.index];
  if (step === "review") return draft;
  return { ...draft, index: draft.index + 1, completed: [...draft.completed, step] };
}
export function canSubmitCapture(draft: CaptureDraft) {
  return draft.plan[draft.index] === "review" && draft.completed.includes("qr") && draft.plan.every(step => step === "review" || draft.completed.includes(step));
}
