import { beforeEach, expect, it, vi } from "vitest";
const { finalMessage, stream } = vi.hoisted(() => ({ finalMessage: vi.fn(), stream: vi.fn() }));
vi.mock("./client", () => ({ getAnthropic: () => ({ messages: { stream } }) }));
import { extractMeterReading, parseMeterReading } from "./meterReading";
beforeEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); stream.mockReturnValue({ finalMessage }); });
const good = { odometerKm: 123456, fuelFraction: 0.5, issues: [] };
it("読取結果は確認前の候補とし、不明の燃料をゼロで埋めない", () => {
  expect(parseMeterReading(good)).toEqual({ ...good, status: "candidate" });
  expect(parseMeterReading({ ...good, fuelFraction: null })).toMatchObject({ fuelFraction: null, status: "needs_review" });
});
it.each(["glare", "blur", "dark", "not_dashboard"])("%sでも返された数字を信用しない", issue => {
  expect(parseMeterReading({ ...good, issues: [issue] })).toMatchObject({ odometerKm: null, fuelFraction: null, status: "needs_review" });
});
it("TRIPと単位不明は走行距離に採用しない", () => {
  expect(parseMeterReading({ ...good, issues: ["trip_only"] }).odometerKm).toBeNull();
  expect(parseMeterReading({ ...good, issues: ["unknown_unit"] }).odometerKm).toBeNull();
});
it.each([{ ...good, odometerKm: "123456" }, { ...good, fuelFraction: 5 }, { ...good, odometerKm: -1 }, {}])("不正な構造・単位・範囲を拒否", value => { expect(() => parseMeterReading(value)).toThrow(); });
it("設定前は外部APIを呼ばず、拒否・打切り結果を保存候補にしない", async () => {
  vi.stubEnv("HAKOTORA_METER_AI_MODEL", "");
  await expect(extractMeterReading(new Uint8Array([1]), "image/jpeg")).rejects.toThrow("未設定");
  expect(stream).not.toHaveBeenCalled();
  vi.stubEnv("HAKOTORA_METER_AI_MODEL", "test-model");
  finalMessage.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
  await expect(extractMeterReading(new Uint8Array([1]), "image/jpeg")).rejects.toThrow("完了できません");
  finalMessage.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(good) }] });
  expect(await extractMeterReading(new Uint8Array([1]), "image/jpeg")).toMatchObject({ odometerKm: 123456, status: "candidate" });
  vi.unstubAllEnvs();
});
