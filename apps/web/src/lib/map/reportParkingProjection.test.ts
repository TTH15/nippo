import { describe, expect, it } from "vitest";
import { mapImageOffset, mapImagePoint } from "./reportParkingProjection";

describe("parking image projection", () => {
  const center = { lat: 34.79, lng: 135.47 };
  it("uses the actual viewport center and north-up map scale", () => {
    expect(mapImagePoint(center, 16, 0, 0)).toEqual({ lat: expect.closeTo(center.lat, 7), lng: expect.closeTo(center.lng, 7) });
    expect(mapImagePoint(center, 16, 80, -30).lat).toBeGreaterThan(center.lat);
    const worldPixels = 512 * 2 ** 16;
    expect(mapImagePoint(center, 16, 80, 0).lng).toBeCloseTo(center.lng + 360 * 80 / worldPixels, 7);
  });
  it("puts the pin back where it was clicked after projecting even near the dateline", () => {
    const across = { lat: 45, lng: 179.99 };
    const point = mapImagePoint(across, 10, 100, 70);
    expect(point.lng).toBeLessThan(0);
    const pixel = mapImageOffset(point, across, 10);
    expect(pixel.x).toBeCloseTo(100, 6);
    expect(pixel.y).toBeCloseTo(70, 6);
  });
  it("retains a selected registered marker location without modifying it", () => {
    const place = { lat: 34.791, lng: 135.4701 };
    const pixel = mapImageOffset(place, center, 17);
    expect(pixel.x).toBeGreaterThan(0);
    expect(pixel.y).toBeLessThan(0);
    const result = mapImagePoint(center, 17, pixel.x, pixel.y);
    expect(result.lat).toBeCloseTo(place.lat, 7);
    expect(result.lng).toBeCloseTo(place.lng, 7);
  });
});
