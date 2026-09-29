import { describe, expect, it } from "vitest";
import { mapAppPreference, parkingMapUrl } from "../src/maps";

describe("parking map handoff", () => {
  const place = { name: "駐車場 & A", latitude: 35.013764, longitude: 135.783184 };
  it("keeps the exact recorded coordinates and escapes the label", () => {
    const apple = new URL(parkingMapUrl("apple", place));
    expect(apple.searchParams.get("ll")).toBe("35.013764,135.783184");
    expect(apple.searchParams.get("q")).toBe(place.name);
    const google = new URL(parkingMapUrl("google", place));
    expect(google.searchParams.get("api")).toBe("1");
    expect(google.searchParams.get("query")).toBe("35.013764,135.783184");
    expect(google.searchParams.has("origin")).toBe(false);
  });
  it("rejects invalid locations instead of opening a misleading pin", () => {
    for (const [latitude, longitude] of [[NaN, 1], [91, 1], [1, -181], [1, Infinity]]) {
      expect(() => parkingMapUrl("google", { ...place, latitude, longitude })).toThrow();
    }
    expect(parkingMapUrl("apple", { ...place, latitude: 0, longitude: 0 })).toContain("0%2C0");
  });
  it("preserves a saved choice and defaults per platform for invalid storage", () => {
    expect(mapAppPreference("google", "ios")).toBe("google");
    expect(mapAppPreference("bad", "ios")).toBe("apple");
    expect(mapAppPreference(null, "android")).toBe("google");
  });
});
