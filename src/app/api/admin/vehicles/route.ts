import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 全車両一覧（回収済みマーク含む）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select(`
      *,
      vehicle_drivers (
        driver_id,
        drivers (id, name, display_name)
      )
    `)
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

  const vehiclesWithRecovery = (vehicles ?? []).map((v: { id: string; [key: string]: unknown }) => ({
    ...v,
    recovery_collected: collectedByVehicle.get(v.id) ?? {},
  }));

  return NextResponse.json({ vehicles: vehiclesWithRecovery });
}

// POST: 車両追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const {
      isDisposed = false,
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
      leaseCost = 35000,
      monthlyInsurance = 0,
      imageUrl = null,
      nextShakenDate,
      jibaisekiRenewalMonth = null,
      driverIds = [],
    } = body;

    const hasIdentity = (manufacturer?.trim() || brand?.trim());
    if (!hasIdentity) {
      return NextResponse.json({ error: "メーカー名またはブランド名が必須です" }, { status: 400 });
    }

    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .insert({
        manufacturer: manufacturer?.trim() || null,
        brand: brand?.trim() || null,
        is_disposed: !!isDisposed,
        number_prefix: numberPrefix || null,
        number_class: numberClass || null,
        number_hiragana: numberHiragana || null,
        number_numeric: isDisposed ? "0000" : (numberNumeric || null),
        current_mileage: currentMileage,
        last_oil_change_mileage: lastOilChangeMileage,
        oil_change_interval: oilChangeInterval,
        purchase_cost: purchaseCost,
        lease_cost: leaseCost,
        monthly_insurance: monthlyInsurance,
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
