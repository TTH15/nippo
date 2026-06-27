import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  loadDailyLeaseByVehicleMonth,
  buildVehicleRecovery,
  currentYm,
} from "@/server/billing/vehicleRecovery";

export const dynamic = "force-dynamic";

type PurchaseCostItem = {
  sign: "+" | "-";
  label: string;
  amount: number;
};

function normalizePurchaseCostItems(input: unknown): PurchaseCostItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => {
      const sign = x && typeof x === "object" && (x as { sign?: unknown }).sign === "-" ? "-" : "+";
      const rawLabel = x && typeof x === "object" ? String((x as { label?: unknown }).label ?? "") : "";
      const label = rawLabel.trim();
      const rawAmount = x && typeof x === "object" ? Number((x as { amount?: unknown }).amount) : 0;
      const amount = Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount)) : 0;
      if (!label && amount === 0) return null;
      return { sign, label, amount };
    })
    .filter((x): x is PurchaseCostItem => x != null);
}

function totalFromItems(items: PurchaseCostItem[]): number {
  const total = items.reduce((sum, item) => sum + (item.sign === "-" ? -item.amount : item.amount), 0);
  return Math.max(0, total);
}

// GET: 全車両一覧（回収済みマーク含む）
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select(`
      *,
      vehicle_drivers (
        driver_id,
        drivers (id, name, display_name)
      )
    `)
    .eq("owner_org_id", orgId)
    .order("manufacturer")
    .order("brand");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 回収済みマークを取得
  const vehicleIds = (vehicles ?? []).map((v: { id: string }) => v.id);
  const { data: collectedRows } = vehicleIds.length > 0
    ? await supabase
        .from("vehicle_recovery_collected")
        .select("vehicle_id, month, collected_at")
        .in("vehicle_id", vehicleIds)
    : { data: [] };

  const collectedByVehicle = new Map<string, Record<number, string>>();
  (collectedRows ?? []).forEach((r: { vehicle_id: string; month: number; collected_at: string }) => {
    if (!collectedByVehicle.has(r.vehicle_id)) {
      collectedByVehicle.set(r.vehicle_id, {});
    }
    collectedByVehicle.get(r.vehicle_id)![r.month] = r.collected_at;
  });

  // 回収v2: 繰越＋自動カレンダー月＋日額自動計上＋手動行 から回収済み額を算出
  const [{ data: manualRows }, dailyMap] = vehicleIds.length > 0
    ? await Promise.all([
        supabase
          .from("vehicle_recovery_entries")
          .select("id, vehicle_id, ym, lease, insurance, note")
          .in("vehicle_id", vehicleIds),
        loadDailyLeaseByVehicleMonth(supabase),
      ])
    : [{ data: [] as any[] }, new Map<string, Map<string, number>>()] as const;
  const manualByVehicle = new Map<string, any[]>();
  (manualRows ?? []).forEach((m: any) => {
    const arr = manualByVehicle.get(m.vehicle_id) ?? [];
    arr.push({
      id: String(m.id),
      vehicle_id: String(m.vehicle_id),
      ym: String(m.ym),
      lease: Number(m.lease) || 0,
      insurance: Number(m.insurance) || 0,
      note: m.note ?? null,
    });
    manualByVehicle.set(m.vehicle_id, arr);
  });
  const nowYm = currentYm();

  const vehiclesWithRecovery = (vehicles ?? []).map((v: { id: string; [key: string]: unknown }) => {
    const rec = buildVehicleRecovery(
      v as any,
      dailyMap.get(v.id) ?? new Map<string, number>(),
      manualByVehicle.get(v.id) ?? [],
      nowYm,
    );
    return {
      ...v,
      recovery_collected: collectedByVehicle.get(v.id) ?? {},
      recovered_amount: rec.recovered,
      remaining_amount: rec.remaining,
    };
  });

  return NextResponse.json({ vehicles: vehiclesWithRecovery });
}

// POST: 車両追加
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const {
      isDisposed = false,
      isEv = false,
      manufacturer,
      brand,
      numberPrefix,
      numberClass,
      numberHiragana,
      numberNumeric,
      currentMileage = 0,
      lastOilChangeMileage = 0,
      oilChangeInterval = 3000,
      purchaseCost = 0,
      purchaseCostItems = [],
      leaseCost = 35000,
      monthlyInsurance = 0,
      recoveryStartMonth = null,
      recoveryCarryover = null,
      imageUrl = null,
      nextShakenDate,
      jibaisekiRenewalMonth = null,
      driverIds = [],
    } = body;

    const hasIdentity = (manufacturer?.trim() || brand?.trim());
    if (!hasIdentity) {
      return NextResponse.json({ error: "メーカー名またはブランド名が必須です" }, { status: 400 });
    }

    const normalizedItems = normalizePurchaseCostItems(purchaseCostItems);
    const computedPurchaseCost = normalizedItems.length > 0 ? totalFromItems(normalizedItems) : Number(purchaseCost) || 0;

    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .insert({
        owner_org_id: orgId,
        manufacturer: manufacturer?.trim() || null,
        brand: brand?.trim() || null,
        is_disposed: !!isDisposed,
        is_ev: !!isEv,
        number_prefix: numberPrefix || null,
        number_class: numberClass || null,
        number_hiragana: numberHiragana || null,
        number_numeric: isDisposed ? "0000" : (numberNumeric || null),
        current_mileage: currentMileage,
        last_oil_change_mileage: lastOilChangeMileage,
        oil_change_interval: oilChangeInterval,
        purchase_cost: computedPurchaseCost,
        purchase_cost_items: normalizedItems.length > 0 ? normalizedItems : null,
        lease_cost: leaseCost,
        monthly_insurance: monthlyInsurance,
        recovery_start_month:
          recoveryStartMonth && /^\d{4}-\d{2}/.test(String(recoveryStartMonth))
            ? `${String(recoveryStartMonth).slice(0, 7)}-01`
            : null,
        recovery_carryover: recoveryCarryover != null ? Math.max(0, Math.trunc(Number(recoveryCarryover) || 0)) : 0,
        image_url: imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null,
        next_shaken_date: nextShakenDate && String(nextShakenDate).trim() ? String(nextShakenDate).trim() : null,
        jibaiseki_renewal_month:
          jibaisekiRenewalMonth && /^\d{4}-\d{2}$/.test(String(jibaisekiRenewalMonth))
            ? String(jibaisekiRenewalMonth)
            : null,
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ドライバーリレーションを追加
    if (Array.isArray(driverIds) && driverIds.length > 0) {
      const vehicleDrivers = driverIds.map((driverId: string) => ({
        vehicle_id: vehicle.id,
        driver_id: driverId,
      }));
      await supabase.from("vehicle_drivers").insert(vehicleDrivers);
    }

    // リレーション込みで再取得
    const { data: vehicleWithDrivers } = await supabase
      .from("vehicles")
      .select(`
        *,
        vehicle_drivers (
          driver_id,
          drivers (id, name, display_name)
        )
      `)
      .eq("id", vehicle.id)
      .single();

    return NextResponse.json({ vehicle: vehicleWithDrivers });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
