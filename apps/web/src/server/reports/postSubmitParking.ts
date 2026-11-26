import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { loadDriverLease } from "@/server/billing/driverLease";
import { parseParkingReport } from "./parking";

export const POST_SUBMIT_PARKING_POLICY = "post_submit_map";
export const PARKING_STAGE_FIELD = "_pwaParkingStage";
export type ParkingStage = "required" | "not_required" | "complete";
type Owner = { orgId: string; driverId: string };
type Item = { vehicleId?: string | null; [name: string]: unknown };
type Snapshot = { reportDate: string; vehicleId: string | null; stage: "required" | "not_required" };

export async function readParkingReceipt(db: SupabaseClient, ctx: Owner, key: string): Promise<Snapshot | null> {
  const { data, error } = await db.from("report_submission_receipts").select("payload")
    .eq("org_id", ctx.orgId).eq("driver_id", ctx.driverId).eq("client_key", key).maybeSingle();
  if (error) throw error;
  const payload = data?.payload as { date?: unknown; items?: Item[] } | undefined;
  if (!isDateOnly(payload?.date) || !Array.isArray(payload.items)) return null;
  const stage = payload.items[0]?.[PARKING_STAGE_FIELD];
  if (stage !== "required" && stage !== "not_required") return null;
  const vehicles = [...new Set(payload.items.map(item => item.vehicleId).filter(isUuid))];
  if (vehicles.length > 1 || (stage === "required" && vehicles.length !== 1)) return null;
  return { reportDate: payload.date, vehicleId: vehicles[0] ?? null, stage };
}

export async function chooseParkingStage(db: SupabaseClient, ctx: Owner, key: string, reportDate: string, vehicleId: string | null) {
  // A receipt gets the original server decision even when billing changes between network retries.
  const recorded = await readParkingReceipt(db, ctx, key);
  if (recorded) return recorded.stage;
  if (!vehicleId) return "not_required";
  return await requiresVehicleReturn(db, ctx.driverId, reportDate) ? "required" : "not_required";
}

export async function requiresVehicleReturn(db: SupabaseClient, driverId: string, reportDate: string) {
  // courses.daily_lease is a rate for a DAILY contract, not a mode override for a monthly driver.
  // Unknown/read failure is not an exemption.
  const lease = await loadDriverLease(db, driverId, reportDate, reportDate);
  return lease?.mode !== "MONTHLY";
}

export function reportParkingPositionKey(ctx: Owner, receiptKey: string) {
  return createHash("sha256").update(JSON.stringify([POST_SUBMIT_PARKING_POLICY, ctx.orgId, ctx.driverId, receiptKey])).digest("hex");
}

export async function hasParkingPosition(db: SupabaseClient, ctx: Owner, snap: Snapshot, key: string) {
  if (!snap.vehicleId || snap.stage !== "required") return false;
  const { data, error } = await db.from("vehicle_positions").select("id")
    .eq("org_id", ctx.orgId).eq("driver_id", ctx.driverId).eq("vehicle_id", snap.vehicleId)
    .eq("report_date", snap.reportDate).eq("client_key", reportParkingPositionKey(ctx, key)).maybeSingle();
  if (error) throw error;
  return !!data;
}

export function parseConfirmedParking(raw: unknown, snap: Snapshot, key: string, now = new Date()) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "車を停めた場所を地図で確認してください" } as const;
  const parsed = parseParkingReport({ ...raw, clientKey: key }, { reportDate: snap.reportDate, itemVehicleIds: [snap.vehicleId], now });
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (value.status !== "parked" || (!value.placeId && !value.coords) || (value.placeId && value.coords) ||
      value.detectedBy || value.coords?.fixAt || value.coords?.accuracyM != null)
    return { ok: false, error: "車を停めた場所を地図で確認してください" } as const;
  const japanDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" });
  const parkingDay = japanDate.format(new Date(value.at));
  const nextDay = new Date(new Date(snap.reportDate + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10);
  if (!("at" in raw && raw.at) && snap.reportDate !== japanDate.format(now))
    return { ok: false, error: "実際に停めた時刻を確認してください" } as const;
  if (parkingDay !== snap.reportDate && parkingDay !== nextDay)
    return { ok: false, error: "駐車の時刻は日報の日か翌日にしてください" } as const;
  return parsed;
}
