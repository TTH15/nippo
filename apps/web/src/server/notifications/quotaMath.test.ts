import { describe, it, expect } from "vitest";
import { computeRemaining, jstMonthStartIso } from "./quotaMath";

// org 別 LINE 通数の残数計算。複数org運用の土台。
describe("computeRemaining", () => {
  it("上限内なら残数を返す", () => {
    expect(computeRemaining(1000, 300)).toBe(700);
  });

  it("上限ちょうどは0", () => {
    expect(computeRemaining(1000, 1000)).toBe(0);
  });

  it("超過してもマイナスにしない（0どまり）", () => {
    expect(computeRemaining(1000, 1200)).toBe(0);
  });

  it("上限なし（null）は残数の概念を持たない", () => {
    expect(computeRemaining(null, 500)).toBeNull();
  });
});

describe("jstMonthStartIso", () => {
  it("月初 JST を UTC に直す（前月末15:00Z）", () => {
    // 2026-07-21 の任意時刻 → 2026-07-01 00:00 JST = 2026-06-30 15:00 UTC
    const iso = jstMonthStartIso(new Date("2026-07-21T10:00:00+09:00"));
    expect(iso).toBe("2026-06-30T15:00:00.000Z");
  });

  it("1月でも前月（前年12月末）を正しく跨ぐ", () => {
    const iso = jstMonthStartIso(new Date("2026-01-15T10:00:00+09:00"));
    expect(iso).toBe("2025-12-31T15:00:00.000Z");
  });
});
