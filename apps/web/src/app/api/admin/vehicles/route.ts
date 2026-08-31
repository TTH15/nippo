import { randomUUID } from "node:crypto";
import { adminMutationError, isUuid } from "@/server/db/adminResourceScope";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { hasCapabilityCached } from "@/server/auth/permissions";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { stripVehicleCostAll } from "@/server/vehicles/cost";
import { filterActiveVehicleDrivers, type VehicleDriverRow } from "@/server/vehicles/activeDrivers";
import { storeVehicleImage, VEHICLE_IMAGE_BUCKET } from "@/server/vehicles/imageStorage";
import { resolveStoredUrls } from "@/server/storage/dataUrl";
import { isMissingVehicleAvailabilityColumns } from "@/server/vehicles/availabilitySchema";

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

// GET: 車両一覧。?limit=&cursor=（cursor は offset）でページング。
// limit 未指定は従来どおり全件（analytics/sales 等の既存利用の互換維持。
// ただし db-max-rows=1000 が上限）。台数が増えても一覧画面は「上から順に」
// 少しずつ取得する（users と同じ自動追い読み方式・2026-08-14）。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") || "0");
  const cursorRaw = Number(url.searchParams.get("cursor") || "0");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : null;
  const offset = Number.isFinite(cursorRaw) ? Math.max(0, Math.floor(cursorRaw)) : 0;

  // ★ select("*") にしない。image_url に data URL が混ざると1台あたり数百KB になり、
  //   一覧のレスポンスが一気に肥大する（実測: 画像込み 1630ms/3777KB → 列指定 217ms/11KB）。
  //   列を明示しておけば、将来 data URL が紛れ込んでも一覧は太らない。
  const loadVehicles = (includeAvailability: boolean) => {
    // 動的テンプレートをselect()へ直接渡すとSupabaseの型パーサーが過剰展開するため、
    // ここでは実行時文字列として明示する。
    const availabilityColumns = includeAvailability ? "is_unavailable, unavailable_reason," : "";
    const selectColumns: string = `
      id, owner_org_id, manufacturer, brand, model_key, model_code, body_color,
      is_disposed, ${availabilityColumns} is_ev,
      number_prefix, number_class, number_hiragana, number_numeric, plate_color,
      current_mileage, last_oil_change_mileage, oil_change_interval,
      purchase_cost, purchase_cost_items, lease_cost, monthly_insurance,
      recovery_start_month, recovery_carryover,
      image_url, image_focus_x, image_focus_y,
      next_shaken_date, jibaiseki_renewal_month, created_at,
      vehicle_drivers (
        driver_id,
        drivers (id, name, display_name, works_as_driver, status, org_id)
      )
    `;
    let query = supabase
      .from("vehicles")
      .select(selectColumns)
      .eq("owner_org_id", orgId)
      .order("manufacturer")
      .order("brand")
      // ページ間で行の重複・欠落を起こさないよう一意なタイブレークを付ける
      .order("id");
    // limit+1 行取って hasMore を判定する
    if (limit !== null) query = query.range(offset, offset + limit);
    return query;
  };

  let availabilitySupported = true;
  let { data: vehiclesRaw, error } = await loadVehicles(true);
  if (isMissingVehicleAvailabilityColumns(error)) {
    // コードが先にデプロイされmigration 147が未適用でも、既存車両を消えたように見せない。
    availabilitySupported = false;
    ({ data: vehiclesRaw, error } = await loadVehicles(false));
  }

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const hasMore = limit !== null && (vehiclesRaw ?? []).length > limit;
  const vehicles = limit !== null ? (vehiclesRaw ?? []).slice(0, limit) : vehiclesRaw;

  // 利用ドライバーは「稼働中」だけを返す（詳細は server/vehicles/activeDrivers.ts）。
  const rawVehicles: Array<{ id: string; [key: string]: unknown }> = (
    (vehicles ?? []) as unknown as Array<{ id: string; [key: string]: unknown }>
  ).map((v) => {
    const links = ((v.vehicle_drivers ?? []) as (VehicleDriverRow & { drivers?: { org_id?: string; works_as_driver?: boolean | null; status?: string | null } | null })[]).filter(link => link.drivers?.org_id === orgId);
    return { ...v, is_unavailable: v.is_unavailable ?? false, unavailable_reason: v.unavailable_reason ?? null,
      // 編集画面では非表示の稼働終了者も比較対象に含め、誤った競合を避ける。
      driver_link_ids: links.map(link => link.driver_id), vehicle_drivers: filterActiveVehicleDrivers(links) };
  });

  // 画像は Storage のパスを署名URLに変換して返す（既存の data URL はそのまま通る）
  const signedUrls = await resolveStoredUrls(
    supabase,
    VEHICLE_IMAGE_BUCKET,
    rawVehicles.map((v) => v.image_url as string | null),
  );
  const activeDriverVehicles = rawVehicles.map((v, i) => ({ ...v, image_url: signedUrls[i] }));

  // 金額列（purchase_cost 等）は capability が無ければサーバー側で落とす。
  // 回収済み/残額の集計（日報の走査を伴う重い処理）は /api/admin/vehicles/recovery に
  // 分離した（2026-08-14）。一覧はここで即返し、画面側が金額を後から流し込むので、
  // 日報が増えても一覧の表示速度は変わらない。
  // requirePermission が解決済みの capability を再利用（認可クエリの二重実行を避ける）
  const canViewCost = await hasCapabilityCached(user, "can_view_vehicle_cost");
  return NextResponse.json({
    vehicles: stripVehicleCostAll(activeDriverVehicles, canViewCost),
    canViewCost,
    availabilitySupported,
    ...(limit !== null ? { hasMore, nextCursor: String(offset + limit) } : {}),
  });
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
      isUnavailable,
      unavailableReason,
      isEv = false,
      manufacturer,
      brand,
      modelKey,
      modelCode,
      bodyColor,
      plateColor = "black",
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

    if (!Array.isArray(driverIds) || !driverIds.every(isUuid)) return NextResponse.json({ error: "ドライバーの指定が不正です。" }, { status: 400 });
    if (driverIds.length) {
      const { data, error } = await supabase.from("drivers").select("id").eq("org_id", orgId).in("id", driverIds);
      if (error) throw error;
      if (new Set(data?.map(d => d.id)).size !== new Set(driverIds).size) return NextResponse.json({ error: "ドライバーが見つかりません。" }, { status: 404 });
    }
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

    const patch = {
        manufacturer: manufacturer?.trim() || null,
        brand: brand?.trim() || null,
        // 地図の3Dモデルと車体色（migration 123）。車種名から解決した値が渡ってくる
        model_key: typeof modelKey === "string" && modelKey ? modelKey : null,
        // 型式（世代）。3Dモデルの出し分けと車両の記録の両方に使う
        model_code: typeof modelCode === "string" && modelCode.trim() ? modelCode.trim().toUpperCase() : null,
        body_color: typeof bodyColor === "string" && /^#[0-9a-fA-F]{6}$/.test(bodyColor) ? bodyColor : null,
        is_disposed: !!isDisposed,
        // migration 147 未適用環境との互換性のため、クライアントが状態を送った場合だけ列へ書く。
        ...(isUnavailable !== undefined || unavailableReason !== undefined
          ? {
              // 廃車と一時使用不可は排他的。廃車を優先する。
              is_unavailable: !isDisposed && !!isUnavailable,
              unavailable_reason:
                !isDisposed && isUnavailable && typeof unavailableReason === "string"
                  ? unavailableReason.trim().slice(0, 120) || null
                  : null,
            }
          : {}),
        is_ev: !!isEv,
        // プレート色（実物4種）。不正値・未指定は black（現行運用は軽事業のみ）
        plate_color: ["white", "yellow", "green", "black"].includes(plateColor) ? plateColor : "black",
        number_prefix: numberPrefix || null,
        number_class: numberClass || null,
        number_hiragana: numberHiragana || null,
        number_numeric: numberNumeric || null, // 廃車でもナンバーは保持（赤斜線表示で示す）
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
      };
    const { data: vehicle, error } = await supabase.rpc("save_vehicle_with_drivers", {
      p_org_id: orgId, p_vehicle_id: randomUUID(), p_patch: patch,
      p_driver_ids: driverIds, p_expected_driver_ids: [], p_create: true,
    });
    if (error) return adminMutationError(error);
    return NextResponse.json({ vehicle });
  } catch (err) {
    return adminMutationError(err);
  }
}
