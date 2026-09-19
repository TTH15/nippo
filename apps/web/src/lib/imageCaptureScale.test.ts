import { describe, expect, it } from "vitest";
import { captureScale, MAX_IMAGE_AREA, MAX_IMAGE_SIDE } from "./imageCaptureScale";

describe("画像の倍率", () => {
  it("小さい表は高精細（既定の3倍）で描く", () => {
    expect(captureScale(600, 500)).toBe(3);
  });

  it("1ヶ月ぶんの横長でも等倍を下回らない", () => {
    // 31日 × 40人ぶん相当
    const scale = captureScale(4692, 4400);
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(4692 * scale * 4400 * scale).toBeLessThanOrEqual(MAX_IMAGE_AREA + 1);
  });

  it("縦に長い配車表でも1辺の上限を超えない", () => {
    // 100人ぶんの日別配車（幅408・行60px）
    const scale = captureScale(408, 6000);
    expect(408 * scale).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
    expect(6000 * scale).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
  });

  it("面積の上限を超えない", () => {
    const scale = captureScale(8000, 8000);
    expect(8000 * scale * 8000 * scale).toBeLessThanOrEqual(MAX_IMAGE_AREA + 1);
  });

  it("等倍でも上限を超えるときだけ1を下回る", () => {
    const huge = captureScale(20_000, 20_000);
    expect(huge).toBeLessThan(1);
    expect(20_000 * huge).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
  });

  it("大きさが取れないときは等倍", () => {
    expect(captureScale(0, 100)).toBe(1);
    expect(captureScale(100, Number.NaN)).toBe(1);
  });
});
