import * as Haptics from "expo-haptics";
import type { RibbonFeedback } from "./ribbon-feedback";

// 開発専用。成功はAPI受理の記録であり、実際の振動を計測した値ではない。
export const hapticDiagnostics = { attempts: 0, accepted: 0, lastKind: "", error: "" };
export async function playRibbonFeedback(kind: RibbonFeedback) {
  hapticDiagnostics.attempts++; hapticDiagnostics.lastKind = kind; hapticDiagnostics.error = "";
  try {
    if (kind === "grab") await Haptics.selectionAsync();
    else if (kind === "tick") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === "ready") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    hapticDiagnostics.accepted++;
  } catch (error) { hapticDiagnostics.error = String(error); throw error; }
}
