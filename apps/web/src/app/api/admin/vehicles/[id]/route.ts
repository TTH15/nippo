import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { adminMutationError, belongsToOrg, isUuid } from "@/server/db/adminResourceScope";
import { storeVehicleImage } from "@/server/vehicles/imageStorage";
import { normalizeVehicleInteger, validateVehicleForm } from "@/lib/vehicleAdmin";

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
  if (!isUuid(vehicleId)) {
    return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
  }

  try {
    if (!await belongsToOrg("vehicles", vehicleId, orgId)) {
      return NextResponse.json({ error: "車両が見つかりません。" }, { status: 404 });
    }
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    const validationIssue = validateVehicleForm(body, { requireIdentity: false })[0];
    if (validationIssue) return NextResponse.json({ error: validationIssue.message }, { status: 400 });
    if (body.driverIds !== undefined) {
      if (!Array.isArray(body.driverIds) || !body.driverIds.every(isUuid)) return NextResponse.json({ error: "ドライバーの指定が不正です。" }, { status: 400 });
      if (!Array.isArray(body.expectedDriverIds) || !body.expectedDriverIds.every(isUuid)) return NextResponse.json({ error: "車両の最新の紐付けを読み込んでから保存してください。" }, { status: 428 });
      if (body.driverIds.length) {
        const { data, error } = await supabase.from("drivers").select("id").eq("org_id", orgId).in("id", body.driverIds);
        if (error) throw error;
        if (new Set(data?.map(d => d.id)).size !== new Set(body.driverIds).size) return NextResponse.json({ error: "ドライバーが見つかりません。" }, { status: 404 });
      }
    }
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
    if (manufacturer !== undefined) {
      updates.manufacturer = typeof manufacturer === "string" ? manufacturer.trim() || null : null;
    }
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
    if (brand !== undefined) updates.brand = typeof brand === "string" ? brand.trim() || null : null;
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
    if (currentMileage !== undefined) updates.current_mileage = normalizeVehicleInteger(currentMileage, 0);
    if (lastOilChangeMileage !== undefined) {
      updates.last_oil_change_mileage = normalizeVehicleInteger(lastOilChangeMileage, 0);
    }
    if (oilChangeInterval !== undefined) updates.oil_change_interval = normalizeVehicleInteger(oilChangeInterval, 3000);
    if (purchaseCostItems !== undefined) {
      const normalizedItems = normalizePurchaseCostItems(purchaseCostItems);
      updates.purchase_cost_items = normalizedItems.length > 0 ? normalizedItems : null;
      updates.purchase_cost = totalFromItems(normalizedItems);
    } else if (purchaseCost !== undefined) {
      updates.purchase_cost = purchaseCost;
    }
    if (leaseCost !== undefined) updates.lease_cost = normalizeVehicleInteger(leaseCost, 35000);
    if (monthlyInsurance !== undefined) updates.monthly_insurance = normalizeVehicleInteger(monthlyInsurance, 0);
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

    // 本体と紐付けを同じトランザクションで確定。失敗時の逐次保存へのフォールバックはしない。
    const { error } = await supabase.rpc("save_vehicle_with_drivers", {
      p_org_id: orgId,
      p_vehicle_id: vehicleId,
      p_patch: updates,
      p_driver_ids: driverIds ?? null,
      p_expected_driver_ids: body.expectedDriverIds ?? null,
    });
    if (error) return adminMutationError(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminMutationError(err);
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
  if (!isUuid(vehicleId)) {
    return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
  }

  const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId).eq("owner_org_id", orgId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
