import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { hasCapabilityCached } from "@/server/auth/permissions";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  loadDailyLeaseByVehicleMonth,
  buildVehicleRecovery,
  currentYm,
} from "@/server/billing/vehicleRecovery";

export const dynamic = "force-dynamic";

// GET: 全車両の回収済み額・残額（回収v2の集計だけを返す軽量エンドポイント）。
// 一覧 /api/admin/vehicles から分離した（2026-08-14）: 集計は承認済み日報の走査
// （または migration 131 の集計RPC）を伴い日報件数に比例して重くなるため、
// 一覧はまず軽い列だけで描画し、金額列はこの結果を後から流し込む。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;

  // 金額は別 capability。持たない人には集計自体を行わない（値も返さない）
  const canViewCost = await hasCapabilityCached(user, "can_view_vehicle_cost");
  if (!canViewCost) {
    return NextResponse.json({ canViewCost: false, recovery: null });
  }

  const orgId = await resolveOrgId(user.driverId);
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, purchase_cost, lease_cost, monthly_insurance, recovery_start_month, recovery_carryover")
    .eq("owner_org_id", orgId);
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const vehicleIds = (vehicles ?? []).map((v: { id: string }) => v.id);
  if (vehicleIds.length === 0) {
    return NextResponse.json({ canViewCost: true, recovery: {} });
  }

  // 回収v2: 繰越＋自動カレンダー月＋日額自動計上＋手動行 から回収済み額を算出
  const [{ data: manualRows }, dailyMap] = await Promise.all([
    supabase
      .from("vehicle_recovery_entries")
      .select("id, vehicle_id, ym, lease, insurance, note")
      .in("vehicle_id", vehicleIds),
    // ★vehicleIds を必ず渡す。省くと全社・全期間の承認済み日報を
    //   最大10万件走査することになり、表示が大幅に遅くなる。
    loadDailyLeaseByVehicleMonth(supabase, orgId, vehicleIds),
  ]);
  const manualByVehicle = new Map<
    string,
    { id: string; vehicle_id: string; ym: string; lease: number; insurance: number; note: string | null }[]
  >();
  (manualRows ?? []).forEach((m: Record<string, unknown>) => {
    const vehicleId = String(m.vehicle_id);
    const arr = manualByVehicle.get(vehicleId) ?? [];
    arr.push({
      id: String(m.id),
      vehicle_id: vehicleId,
      ym: String(m.ym),
      lease: Number(m.lease) || 0,
      insurance: Number(m.insurance) || 0,
      note: (m.note as string | null) ?? null,
    });
    manualByVehicle.set(vehicleId, arr);
  });
  const nowYm = currentYm();

  const recovery: Record<string, { recovered: number; remaining: number }> = {};
  for (const v of vehicles ?? []) {
    const rec = buildVehicleRecovery(
      v,
      dailyMap.get(v.id) ?? new Map<string, number>(),
      manualByVehicle.get(v.id) ?? [],
      nowYm,
    );
    recovery[v.id] = { recovered: rec.recovered, remaining: rec.remaining };
  }

  return NextResponse.json({ canViewCost: true, recovery });
}
