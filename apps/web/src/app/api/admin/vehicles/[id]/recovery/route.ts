import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import {
  loadDailyLeaseByVehicleMonth,
  buildVehicleRecovery,
  currentYm,
} from "@/server/billing/vehicleRecovery";

export const dynamic = "force-dynamic";

// GET: 1車両の初期費用回収の内訳（繰越＋自動カレンダー月＋日額自動計上＋手動行）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await params;
  if (!vehicleId) return NextResponse.json({ error: "vehicle id required" }, { status: 400 });

  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select("id, purchase_cost, lease_cost, monthly_insurance, recovery_start_month, recovery_carryover")
    .eq("id", vehicleId)
    .maybeSingle();
  if (error || !vehicle) {
    return NextResponse.json({ error: "車両が見つかりません" }, { status: 404 });
  }

  const [{ data: manualRows }, dailyMap] = await Promise.all([
    supabase
      .from("vehicle_recovery_entries")
      .select("id, vehicle_id, ym, lease, insurance, note")
      .eq("vehicle_id", vehicleId)
      .order("ym", { ascending: true }),
    loadDailyLeaseByVehicleMonth(supabase, [vehicleId]),
  ]);

  const dailyByMonth = dailyMap.get(vehicleId) ?? new Map<string, number>();
  const recovery = buildVehicleRecovery(
    vehicle as any,
    dailyByMonth,
    (manualRows ?? []).map((m: any) => ({
      id: String(m.id),
      vehicle_id: String(m.vehicle_id),
      ym: String(m.ym),
      lease: Number(m.lease) || 0,
      insurance: Number(m.insurance) || 0,
      note: m.note ?? null,
    })),
    currentYm(),
  );

  return NextResponse.json({ recovery });
}
