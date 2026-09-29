import { describe, expect, it } from "vitest";
import { qrMotionTarget } from "../src/capture/qr-geometry";

describe("QRの角とガイドの位置", () => {
  const corners = [{ x: 110, y: 110 }, { x: 270, y: 110 }, { x: 270, y: 270 }, { x: 110, y: 270 }];
  it("iOSとAndroidの角の並び順で同じ吸着位置になる", () => {
    const android = qrMotionTarget(corners, 380, 380);
    const ios = qrMotionTarget([corners[3], corners[2], corners[0], corners[1]], 380, 380);
    expect(ios).toEqual(android);
    expect(android?.box).toEqual({ x: 36, y: 36, width: 160, height: 160, angleDeg: 0 });
    expect(android?.finders[0].x).toBeGreaterThan(android!.box.x);
  });
  it("枠外と角座標の欠落は推測で吸着させない", () => {
    expect(qrMotionTarget([], 380, 380)).toBeNull();
    expect(qrMotionTarget(corners.map(point => ({ x: point.x + 200, y: point.y })), 380, 380)).toBeNull();
    expect(qrMotionTarget([{ x: 160, y: 160 }, { x: 250, y: 160 }, { x: 250, y: 250 }, { x: 160, y: 250 }], 380, 380)).toBeNull();
  });
  it("斜めのQRに外枠の角度を合わせる", () => {
    const center = { x: 190, y: 190 }, angle = Math.PI / 6;
    const rotate = (point: { x: number; y: number }) => ({ x: center.x + (point.x - center.x) * Math.cos(angle) - (point.y - center.y) * Math.sin(angle), y: center.y + (point.x - center.x) * Math.sin(angle) + (point.y - center.y) * Math.cos(angle) });
    const result = qrMotionTarget(corners.map(rotate), 380, 380);
    expect(result?.box.angleDeg).toBeCloseTo(30);
    expect(result?.box.width).toBeCloseTo(160);
  });
  it("順番が交差していても外周の4辺へ並べ直す", () => {
    const shuffled = [corners[0], corners[2], corners[1], corners[3]];
    expect(qrMotionTarget(shuffled, 380, 380)?.corners).toEqual(qrMotionTarget(corners, 380, 380)?.corners);
  });
});
