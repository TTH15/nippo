import { describe, expect, it } from "vitest";
import { shiftCorrectionState } from "./shiftCorrectionPolicy";

describe("shiftCorrectionState", () => {
  const today = "2026-11-17";
  it("過去日は未承認でも保護する", () => {
    expect(shiftCorrectionState({ today, date: "2026-11-16", hasFinalizedReport: false, correctionOpen: false })).toBe("past-locked");
  });
  it("午前3時前も昨日は未承認・承認済みとも変更を保護する", () => {
    expect(shiftCorrectionState({ today, date: "2026-11-16", hasFinalizedReport: false, correctionOpen: false })).toBe("past-locked");
    expect(shiftCorrectionState({ today, date: "2026-11-16", hasFinalizedReport: false, correctionOpen: false })).toBe("past-locked");
  });
  it("実際に確定済みの日報だけ確定色にする", () => {
    expect(shiftCorrectionState({ today, date: "2026-11-16", hasFinalizedReport: true, correctionOpen: false })).toBe("approved-locked");
  });
  it("確定解除中は修正状態を表示する", () => {
    expect(shiftCorrectionState({ today, date: "2026-11-16", hasFinalizedReport: true, correctionOpen: true })).toBe("correction");
  });
  it("今日以降で未承認なら通常状態", () => {
    expect(shiftCorrectionState({ today, date: "2026-11-18", hasFinalizedReport: false, correctionOpen: false })).toBe("editable");
  });
});
