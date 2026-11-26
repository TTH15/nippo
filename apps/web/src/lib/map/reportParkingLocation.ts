export type MapPoint = { lat: number; lng: number };
export type DeviceFix = MapPoint & { accuracyM: number; timestamp: number };

export function validParkingPoint(value: MapPoint): boolean {
  return Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
}

export async function getParkingPermission(): Promise<PermissionState | null> {
  try { return (await navigator.permissions?.query({ name: "geolocation" }))?.state ?? null; }
  catch { return null; }
}

/** One-shot and only on opening the parking sheet for a report dated today. */
export function getParkingFix(): Promise<DeviceFix | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => resolve({
      lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy, timestamp,
    }), () => resolve(null), { maximumAge: 0, timeout: 8000, enableHighAccuracy: true });
  });
}

export function usableParkingFix(fix: DeviceFix | null, now = Date.now()): fix is DeviceFix {
  return !!fix && validParkingPoint(fix) && Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0 && fix.accuracyM <= 60 &&
    Number.isFinite(fix.timestamp) && fix.timestamp <= now + 3000 && now - fix.timestamp <= 60_000;
}
