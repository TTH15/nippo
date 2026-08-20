import { describe, expect, it } from "vitest";
import { selectEffectiveRateVersion } from "./rateSnapshot";

describe("selectEffectiveRateVersion", () => {
  const versions = [
    { course_id: "c1", effective_from: "2026-01-01", value: 100 },
    { course_id: "c1", effective_from: "2026-09-01", value: 120 },
    { course_id: "c2", effective_from: "2026-01-01", value: 999 },
  ];

  it("日報日以前で最も新しい単価を選ぶ", () => {
    expect(selectEffectiveRateVersion(versions, "c1", "2026-08-31")?.value).toBe(100);
    expect(selectEffectiveRateVersion(versions, "c1", "2026-09-01")?.value).toBe(120);
  });

  it("適用開始前ならnull", () => {
    expect(selectEffectiveRateVersion(versions, "c1", "2025-12-31")).toBeNull();
  });
});
