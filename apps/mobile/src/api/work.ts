// 出退勤（車両セッション）API ヘルパー。サーバ: apps/web /api/work, /api/vehicle-qr。
//   設計: docs/vehicle-session-flow.md §2,§3,§8
import { apiFetch } from "@repo/core/api";

export type WorkSession = {
  id: string;
  vehicle_id: string;
  status: "open" | "closed";
  purpose: string;
  started_at: string | null;
  start_odometer: number | null;
  ended_at: string | null;
  end_odometer: number | null;
};

export type TodayState = { open: WorkSession | null; today: WorkSession[] };

export type ResolvedVehicle = {
  id: string;
  numberPrefix: string | null;
  numberClass: string | null;
  numberHiragana: string | null;
  numberNumeric: string | null;
};

export type QrResolve = {
  code: string; // ok | revoked | pending_attach | not_authorized | unknown | vehicle_inactive
  ok: boolean;
  message: string | null;
  usage: "owner" | "borrower" | null;
  vehicle: ResolvedVehicle | null;
};

export type GpsStatus = "captured" | "denied" | "unavailable";

export type CheckInBody = {
  token?: string;
  method?: "qr" | "plate_ocr" | "manual";
  vehicleId?: string;
  odometer?: number | null;
  lat?: number | null;
  lng?: number | null;
  gpsStatus?: GpsStatus | null;
  odometerPhotoPath?: string;
};

export type CheckOutBody = CheckInBody & { sessionId?: string };

export type WorkActionResult = {
  ok: boolean;
  code: string;
  message?: string | null;
  session?: WorkSession;
};

export function fetchToday(): Promise<TodayState> {
  return apiFetch<TodayState>("/api/work/today");
}

export function resolveQr(token: string): Promise<QrResolve> {
  return apiFetch<QrResolve>("/api/vehicle-qr/resolve", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function checkIn(body: CheckInBody): Promise<WorkActionResult> {
  return apiFetch<WorkActionResult>("/api/work/check-in", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function checkOut(body: CheckOutBody): Promise<WorkActionResult> {
  return apiFetch<WorkActionResult>("/api/work/check-out", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// メーター写真を Storage にアップロードし保存パスを返す（出退勤の odometerPhotoPath に渡す）。
export function uploadMeterPhoto(base64: string, mime = "image/jpeg"): Promise<{ path: string }> {
  return apiFetch<{ path: string }>("/api/work/meter-photo", {
    method: "POST",
    body: JSON.stringify({ base64, mime }),
  });
}

export function plateText(v: ResolvedVehicle | null): string {
  if (!v) return "";
  return [v.numberPrefix, v.numberClass, v.numberHiragana, v.numberNumeric].filter(Boolean).join(" ");
}
