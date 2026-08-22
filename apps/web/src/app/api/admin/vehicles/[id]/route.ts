import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { storeVehicleImage } from "@/server/vehicles/imageStorage";

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
  const user = await requirePermission(req, "can_manage_vehicles");
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
      isUnavailable,
      unavailableReason,
      isEv,
      manufacturer,
      modelKey,
      modelCode,
      bodyColor,
      brand,
      plateColor,
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
      imageFocusX,
      imageFocusY,
      nextShakenDate,
      jibaisekiRenewalMonth,
      driverIds,
    } = body;

    /** 表示位置は 0〜100（%）に丸める。DB 側の CHECK と揃える。 */
    const clampFocus = (v: unknown) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (manufacturer !== undefined) updates.manufacturer = manufacturer?.trim() || null;
    // 地図の3Dモデル・車体色（migration 123）
    if (modelKey !== undefined) updates.model_key = typeof modelKey === "string" && modelKey ? modelKey : null;
    if (modelCode !== undefined) {
      updates.model_code =
        typeof modelCode === "string" && modelCode.trim() ? modelCode.trim().toUpperCase() : null;
    }
    if (bodyColor !== undefined) {
      updates.body_color =
        typeof bodyColor === "string" && /^#[0-9a-fA-F]{6}$/.test(bodyColor) ? bodyColor : null;
    }
    if (brand !== undefined) updates.brand = brand?.trim() || null;
    if (isDisposed !== undefined) updates.is_disposed = !!isDisposed;
    if (isUnavailable !== undefined) {
      updates.is_unavailable = !!isUnavailable;
      updates.unavailable_reason =
        isUnavailable && typeof unavailableReason === "string"
          ? unavailableReason.trim().slice(0, 120) || null
          : null;
      // 一時使用不可へ戻す操作では、過去の廃車フラグが残らないようにする。
      if (isUnavailable && isDisposed !== true) updates.is_disposed = false;
    } else if (unavailableReason !== undefined) {
      updates.unavailable_reason =
        typeof unavailableReason === "string" ? unavailableReason.trim().slice(0, 120) || null : null;
    }
    // 廃車を優先し、同時に二つの状態を持たせない。
    if (isDisposed === true) {
      updates.is_unavailable = false;
      updates.unavailable_reason = null;
    }
    if (isEv !== undefined) updates.is_ev = !!isEv;
    if (plateColor !== undefined) {
      updates.plate_color = ["white", "yellow", "green", "black"].includes(plateColor) ? plateColor : "black";
    }
    if (numberPrefix !== undefined) updates.number_prefix = numberPrefix || null;
    if (numberClass !== undefined) updates.number_class = numberClass || null;
    if (numberHiragana !== undefined) updates.number_hiragana = numberHiragana || null;
    if (numberNumeric !== undefined) updates.number_numeric = numberNumeric || null;
    // 廃車でもナンバーはリセットしない（廃車時のナンバーのまま一覧で赤斜線表示する。
    // 旧仕様の「null + 0000 に置換」は 2026-08-14 に廃止）
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
    if (imageUrl !== undefined) {
      // data URL で送られてきたら Storage へ上げ、DB にはパスだけ持つ
      const raw = imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null;
      const stored = await storeVehicleImage(supabase, orgId, raw);
      if (!stored.ok) return NextResponse.json({ error: stored.message }, { status: 400 });
      updates.image_url = stored.path;
    }
    if (imageFocusX !== undefined) updates.image_focus_x = clampFocus(imageFocusX);
    if (imageFocusY !== undefined) updates.image_focus_y = clampFocus(imageFocusY);
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
  const user = await requirePermission(req, "can_manage_vehicles");
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
