import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { hasCapability } from "@/server/auth/permissions";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { stripVehicleCostAll } from "@/server/vehicles/cost";
import { filterActiveVehicleDrivers, type VehicleDriverRow } from "@/server/vehicles/activeDrivers";
import { storeVehicleImage, VEHICLE_IMAGE_BUCKET } from "@/server/vehicles/imageStorage";
import { resolveStoredUrls } from "@/server/storage/dataUrl";
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
        drivers (id, name, display_name, works_as_driver, status)
      )
    `)
    .eq("owner_org_id", orgId)
    .order("manufacturer")
    .order("brand");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 利用ドライバーは「稼働中」だけを返す（詳細は server/vehicles/activeDrivers.ts）。
  const rawVehicles: Array<{ id: string; [key: string]: unknown }> = (
    (vehicles ?? []) as Array<{ id: string; [key: string]: unknown }>
  ).map((v) => ({
    ...v,
    vehicle_drivers: filterActiveVehicleDrivers(v.vehicle_drivers as VehicleDriverRow[] | null),
  }));

  // 画像は Storage のパスを署名URLに変換して返す（既存の data URL はそのまま通る）
  const signedUrls = await resolveStoredUrls(
    supabase,
    VEHICLE_IMAGE_BUCKET,
    rawVehicles.map((v) => v.image_url as string | null),
  );
  const activeDriverVehicles = rawVehicles.map((v, i) => ({ ...v, image_url: signedUrls[i] }));

  // 回収済みマークを取得
  const vehicleIds = (vehicles ?? []).map((v: { id: string }) => v.id);

  // 金額情報は別 capability。持たない人には回収額を返さないので、
  // 重い集計（日報の走査）自体を丸ごと省く。
  const canViewCost = await hasCapability(user, "can_view_vehicle_cost");
  if (!canViewCost) {
    return NextResponse.json({
      vehicles: stripVehicleCostAll(activeDriverVehicles, false),
      canViewCost: false,
    });
  }

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
        // ★vehicleIds を必ず渡す。省くと全社・全期間の承認済み日報を
        //   最大10万件走査することになり、一覧表示が大幅に遅くなる。
        loadDailyLeaseByVehicleMonth(supabase, orgId, vehicleIds),
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

  const vehiclesWithRecovery = activeDriverVehicles.map((v: { id: string; [key: string]: unknown }) => {
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

  // ここに来るのは canViewCost === true のときだけ（上で早期 return 済み）
  return NextResponse.json({ vehicles: vehiclesWithRecovery, canViewCost: true });
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
      imageFocusX = 50,
      imageFocusY = 50,
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

    // 画像は Storage へ。DB にはパスだけ持つ（data URL を直接入れない）
    const storedImage = await storeVehicleImage(
      supabase,
      orgId,
      imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null,
    );
    if (!storedImage.ok) return NextResponse.json({ error: storedImage.message }, { status: 400 });
    const storedImagePath = storedImage.path;

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
        image_url: storedImagePath,
        image_focus_x: Math.min(100, Math.max(0, Math.round(Number(imageFocusX) || 50))),
        image_focus_y: Math.min(100, Math.max(0, Math.round(Number(imageFocusY) || 50))),
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
