import type { DeviceFix } from "../../../apps/web/src/lib/map/reportParkingLocation";
import { getParkingFix as browserFix, getParkingPermission as browserPermission } from "../../../apps/web/src/lib/map/reportParkingLocation";
export { usableParkingFix, validParkingPoint } from "../../../apps/web/src/lib/map/reportParkingLocation";

const scenario = () => new URL(location.href).searchParams.get("scenario");
const permissionDemo = () => scenario() === "parking-permission" &&
  (location.hostname === "127.0.0.1" || location.hostname === "localhost" || location.hostname === "[::1]");
export const getParkingPermission = async (): Promise<PermissionState | null> =>
  (permissionDemo() || scenario() === "parking-device") ? browserPermission() : scenario() === "parking-denied" ? "denied" : null;

export const getParkingFix = async (): Promise<DeviceFix | null> => {
  if (scenario() === "parking-device") return window.isSecureContext ? browserFix() : null;
  if (scenario() === "parking-denied" || scenario() === "parking-map-error") return null;
  if (scenario() === "parking-permission") {
    if (!permissionDemo() || !navigator.geolocation) return null;
    // The browser prompts for consent as the parking view opens. Discard the live browser result;
    // neither the Mapbox renderer nor the mock application receives the coordinates.
    const granted = await new Promise<boolean>(resolve =>
      navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), { timeout: 8000, maximumAge: 0 }));
    if (!granted) return null;
  }
  const point = scenario() === "parking-far" ? { lat: 34.7, lng: 135.5 } : { lat: 34.7855, lng: 135.4709 };
  return { ...point, accuracyM: 8, timestamp: Date.now() };
};
