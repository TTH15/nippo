import type { ParkingReport } from "@repo/core/types";
import type { GpsFix } from "./location";

export function endParking(sessionId: string, vehicleId: string, status: ParkingReport["status"], gps: GpsFix): ParkingReport | null {
  const captured = gps.status === "captured" && gps.lat != null && gps.lng != null;
  if (status === "parked" && !captured) return null;
  return {
    vehicleId, status, clientKey: `${sessionId}:parking`,
    coords: status === "parked" && captured ? { lat: gps.lat!, lng: gps.lng!, accuracyM: gps.accuracyM, fixAt: gps.fixAt } : null,
    detectedBy: status === "parked" && captured ? "session_end" as const : null,
  };
}

// 日報で別の車両を選んでも、退勤した車の座標を付け替えない。
export function parkingForReport(vehicleId: string | null, parking?: ParkingReport | null): ParkingReport | null {
  return vehicleId && parking?.vehicleId === vehicleId ? parking : null;
}
