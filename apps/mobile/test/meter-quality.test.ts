import { describe, expect, it, vi } from "vitest";
import { checkMeterPhoto, meterQualityCopy, parseMeterQuality } from "../src/capture/meter-quality";
describe("メーター写真の即時確認", () => {
  it("空の応答や片方だけの確認を合格にしない", () => {
    expect(parseMeterQuality({})).toBeNull();
    expect(parseMeterQuality({ odometerReadable: true, issues: [] })).toBeNull();
    expect(parseMeterQuality({ odometerReadable: true, fuelReadable: true, issues: ["other"] })).toBeNull();
    expect(meterQualityCopy({ status: "ready", result: { odometerReadable: true, fuelReadable: false, issues: [] } }).warning).toBe(true);
  });
  it("両方の表示を確認し、問題がないときだけ確認済みとする", () => {
    const state = { status: "ready" as const, result: { odometerReadable: true, fuelReadable: true, issues: [] } };
    expect(meterQualityCopy(state).warning).toBe(false);
    expect(meterQualityCopy({ ...state, result: { ...state.result, issues: ["glare"] } }).warning).toBe(true);
  });
  it("未接続・エラー・不正な応答を目視確認へ退避する", async () => {
    for (const assessor of [undefined, async () => { throw new Error("offline"); }, async () => ({})]) {
      const state = await checkMeterPhoto("file://photo", "wide", assessor);
      expect(state.status).toBe("unavailable");
      expect(meterQualityCopy(state).label).toBe("目視で確認して使う");
    }
  });
  it("時間切れで復帰し、遅れた合格応答を採用しない", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const promise = checkMeterPhoto("file://photo", "round", async (_, ctx) => {
        signal = ctx.signal;
        await new Promise(r => setTimeout(r, 9000));
        return { odometerReadable: true, fuelReadable: true, issues: [] };
      });
      await vi.advanceTimersByTimeAsync(6000);
      expect(await promise).toEqual({ status: "unavailable" });
      expect(signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await promise).toEqual({ status: "unavailable" });
    } finally { vi.useRealTimers(); }
  });
  it("選択形状を渡すが、数値は品質結果に混ぜない", async () => {
    const assessor = vi.fn(async () => ({ odometerReadable: true, fuelReadable: true, issues: [], odometerKm: 123450 }));
    expect(await checkMeterPhoto("file://photo", "left", assessor)).toEqual({ status: "ready", result: { odometerReadable: true, fuelReadable: true, issues: [] } });
    expect(assessor).toHaveBeenCalledWith("file://photo", expect.objectContaining({ guide: "left" }));
  });
});
