import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PUT: 車両情報更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await params;
  if (!vehicleId) {
    return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      manufacturer,
      brand,
      numberPrefix,
      numberClass,
      numberHiragana,
      numberNumeric,
      currentMileage,
      lastOilChangeMileage,
      oilChangeInterval,
      purchaseCost,
      monthlyInsurance,
      nextShakenDate,
      nextPeriodicInspectionDate,
      driverIds,
    } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (manufacturer !== undefined) updates.manufacturer = manufacturer?.trim() || null;
    if (brand !== undefined) updates.brand = brand?.trim() || null;
    if (numberPrefix !== undefined) updates.number_prefix = numberPrefix || null;
    if (numberClass !== undefined) updates.number_class = numberClass || null;
    if (numberHiragana !== undefined) updates.number_hiragana = numberHiragana || null;
    if (numberNumeric !== undefined) updates.number_numeric = numberNumeric || null;
    if (currentMileage !== undefined) updates.current_mileage = currentMileage;
    if (lastOilChangeMileage !== undefined) updates.last_oil_change_mileage = lastOilChangeMileage;
    if (oilChangeInterval !== undefined) updates.oil_change_interval = oilChangeInterval;
    if (purchaseCost !== undefined) updates.purchase_cost = purchaseCost;
    if (monthlyInsurance !== undefined) updates.monthly_insurance = monthlyInsurance;
    if (nextShakenDate !== undefined) updates.next_shaken_date = nextShakenDate && String(nextShakenDate).trim() ? String(nextShakenDate).trim() : null;
    if (nextPeriodicInspectionDate !== undefined) updates.next_periodic_inspection_date = nextPeriodicInspectionDate && String(nextPeriodicInspectionDate).trim() ? String(nextPeriodicInspectionDate).trim() : null;

    const { error } = await supabase
      .from("vehicles")
      .update(updates)
      .eq("id", vehicleId);

    if (error) throw error;

    // ドライバーリレーションを更新
    if (Array.isArray(driverIds)) {
      // 既存のリレーションを削除
      await supabase.from("vehicle_drivers").delete().eq("vehicle_id", vehicleId);

      // 新しいリレーションを追加
      if (driverIds.length > 0) {
        const vehicleDrivers = driverIds.map((driverId: string) => ({
          vehicle_id: vehicleId,
          driver_id: driverId,
        }));
        await supabase.from("vehicle_drivers").insert(vehicleDrivers);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: 車両削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await params;
  if (!vehicleId) {
    return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
  }

  const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
