import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("expo-haptics", () => ({
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success" },
}));
import * as Haptics from "expo-haptics";
import { playRibbonFeedback, hapticDiagnostics } from "../ui-preview/haptics";
describe("ribbon native feedback", () => {
  beforeEach(() => vi.clearAllMocks());
  it("separates detents from the end and completion feedback", async () => {
    await playRibbonFeedback("grab"); await playRibbonFeedback("tick");
    await playRibbonFeedback("ready"); await playRibbonFeedback("release");
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(1, "light");
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(2, "medium");
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(3, "heavy");
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
  it("does not report acceptance or trigger a stronger fallback after rejection", async () => {
    const accepted = hapticDiagnostics.accepted;
    vi.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error("unavailable"));
    await expect(playRibbonFeedback("tick")).rejects.toThrow("unavailable");
    expect(hapticDiagnostics.accepted).toBe(accepted);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
