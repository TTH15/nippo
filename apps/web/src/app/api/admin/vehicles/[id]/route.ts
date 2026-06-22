import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

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

// PUT: 車両情報更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { id: vehicleId } = await params;
  if (!vehicleId) {
    return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      isDisposed,
      isEv,
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
      purchaseCostItems,
      leaseCost,
      monthlyInsurance,
      recoveryStartMonth,
      recoveryCarryover,
      imageUrl,
      nextShakenDate,
      jibaisekiRenewalMonth,
      driverIds,
    } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (manufacturer !== undefined) updates.manufacturer = manufacturer?.trim() || null;
    if (brand !== undefined) updates.brand = brand?.trim() || null;
    if (isDisposed !== undefined) updates.is_disposed = !!isDisposed;
    if (isEv !== undefined) updates.is_ev = !!isEv;
    if (numberPrefix !== undefined) updates.number_prefix = numberPrefix || null;
    if (numberClass !== undefined) updates.number_class = numberClass || null;
    if (numberHiragana !== undefined) updates.number_hiragana = numberHiragana || null;
    if (numberNumeric !== undefined) updates.number_numeric = numberNumeric || null;
    if (isDisposed === true) {
      updates.number_prefix = null;
      updates.number_class = null;
      updates.number_hiragana = null;
      updates.number_numeric = "0000";
    }
    if (currentMileage !== undefined) updates.current_mileage = currentMileage;
    if (lastOilChangeMileage !== undefined) updates.last_oil_change_mileage = lastOilChangeMileage;
    if (oilChangeInterval !== undefined) updates.oil_change_interval = oilChangeInterval;
    if (purchaseCostItems !== undefined) {
      const normalizedItems = normalizePurchaseCostItems(purchaseCostItems);
      updates.purchase_cost_items = normalizedItems.length > 0 ? normalizedItems : null;
      updates.purchase_cost = totalFromItems(normalizedItems);
    } else if (purchaseCost !== undefined) {
      updates.purchase_cost = purchaseCost;
    }
    if (leaseCost !== undefined) updates.lease_cost = leaseCost;
    if (monthlyInsurance !== undefined) updates.monthly_insurance = monthlyInsurance;
    if (recoveryStartMonth !== undefined) {
      updates.recovery_start_month =
        recoveryStartMonth && /^\d{4}-\d{2}/.test(String(recoveryStartMonth))
          ? `${String(recoveryStartMonth).slice(0, 7)}-01`
          : null;
    }
    if (recoveryCarryover !== undefined) {
      updates.recovery_carryover = Math.max(0, Math.trunc(Number(recoveryCarryover) || 0));
    }
    if (imageUrl !== undefined) updates.image_url = imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null;
    if (nextShakenDate !== undefined) updates.next_shaken_date = nextShakenDate && String(nextShakenDate).trim() ? String(nextShakenDate).trim() : null;
    if (jibaisekiRenewalMonth !== undefined) {
      updates.jibaiseki_renewal_month =
        jibaisekiRenewalMonth && /^\d{4}-\d{2}$/.test(String(jibaisekiRenewalMonth))
          ? String(jibaisekiRenewalMonth)
          : null;
    }

    const { error } = await supabase
      .from("vehicles")
      .update(updates)
      .eq("id", vehicleId)
      .eq("owner_org_id", orgId);

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
  const orgId = await resolveOrgId(user.driverId);

  const { id: vehicleId } = await params;
  if (!vehicleId) {
    return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
  }

  const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId).eq("owner_org_id", orgId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
