import { describe, expect, it } from "vitest";
import { usableParkingFix } from "./reportParkingLocation";
import { snapParkingCoords } from "./parkingSnap";

describe("PWAの駐車候補", () => {
  const now = 1_000_000;
  const fix = { lat: 34.7, lng: 135.5, accuracyM: 8, timestamp: now };
  const place = { id: "p", name: "駐車場", lat: 34.7, lng: 135.5 };
  it("新しく正確な位置だけを候補の計算に使う", () => {
    expect(usableParkingFix(fix, now)).toBe(true);
    expect(usableParkingFix({ ...fix, timestamp: now - 61_000 }, now)).toBe(false);
    expect(usableParkingFix({ ...fix, accuracyM: 61 }, now)).toBe(false);
    expect(usableParkingFix({ ...fix, timestamp: now + 4_000 }, now)).toBe(false);
    expect(usableParkingFix(null, now)).toBe(false);
  });
  it("遠い・複数で曖昧な登録場所を自動候補にしない", () => {
    expect(snapParkingCoords(fix, [place]).placeId).toBe("p");
    expect(snapParkingCoords({ ...fix, lat: 34.71 }, [place]).placeId).toBeNull();
    expect(snapParkingCoords(fix, [place, { ...place, id: "p2" }]).placeId).toBeNull();
  });
});
