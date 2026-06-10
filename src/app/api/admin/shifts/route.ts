import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 指定期間のシフト取得
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const startDate = req.nextUrl.searchParams.get("start");
  const endDate = req.nextUrl.searchParams.get("end");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }

  // Get courses
  const { data: courses } = await supabase
    .from("courses")
    .select("*")
    .order("sort_order");

  const { data: fleet } = await supabase
    .from("vehicles")
    .select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand")
    .eq("is_disposed", false)
    .order("manufacturer")
    .order("brand");

  const fleetById = new Map((fleet ?? []).map((v) => [v.id, v]));

  // Get shifts（vehicle_id は fleet と結合して返す／ネスト名の都合を避ける）
  const { data: shiftsRaw } = await supabase
    .from("shifts")
    .select(
      `
      id, shift_date, course_id, slot, driver_id, vehicle_id, uses_external_vehicle,
      drivers (id, name, display_name)
    `,
    )
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  const shifts =
    shiftsRaw?.map((s) => ({
      ...s,
      vehicles:
        "vehicle_id" in s && s.vehicle_id ? (fleetById.get(s.vehicle_id as string) ?? null) : null,
    })) ?? [];

  const { data: vehicleLinks } = await supabase.from("vehicle_drivers").select("driver_id, vehicle_id");

  // 期間内の車両貸出中（その日付は紐付け不可）
  const { data: vehicleLoans } = await supabase
    .from("vehicle_loans")
    .select("vehicle_id, loan_date, note")
    .gte("loan_date", startDate)
    .lte("loan_date", endDate);

  // Get drivers with their course assignments
  const { data: drivers } = await supabase
    .from("drivers")
    .select(`
      id, name, display_name, role,
      driver_identities (
        driver_courses (course_id)
      )
    `)
    .eq("role", "DRIVER")
    .order("name");

  // Get shift requests (希望休)。slot_id（便。NULL=全休）も含む。
  const { data: requests } = await supabase
    .from("shift_requests")
    .select("*")
    .gte("request_date", startDate)
    .lte("request_date", endDate);

  // 便（時間帯）マスタ（active のみ）。希望休の便名表示用。
  const { data: slots } = await supabase
    .from("shift_request_slots")
    .select("id, name, start_time, end_time")
    .eq("active", true)
    .order("sort_order");

  return NextResponse.json({
    courses: courses ?? [],
    shifts: shifts ?? [],
    drivers: drivers ?? [],
    requests: requests ?? [],
    slots: slots ?? [],
    vehicles: fleet ?? [],
    vehicle_driver_links: vehicleLinks ?? [],
    vehicle_loans: vehicleLoans ?? [],
  });
}

// POST: シフト登録/更新
// 閲覧専用アカウント（ADMIN_VIEWER）にもシフトの編集を許可する運用要件のため ADMIN_OR_VIEWER。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { shiftDate, courseId, driverId, slot, vehicleId, usesExternalVehicle } = body as {
      shiftDate?: string;
      courseId?: string;
      driverId?: string | null;
      slot?: number;
      /** 明示的に null で車両のみクリアすることも許可 */
      vehicleId?: string | null;
      /** 他社の車両を利用するフラグ */
      usesExternalVehicle?: boolean;
    };

    if (!shiftDate || !courseId) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;

    let resolvedVehicleId: string | null | undefined = undefined;
    if ("vehicleId" in body) {
      resolvedVehicleId = vehicleId && typeof vehicleId === "string" ? vehicleId : null;
    }
    // 他社車両フラグが立っているときは自社フリート車両をクリアする。
    const external = usesExternalVehicle === true;
    if (external) resolvedVehicleId = null;

    // 貸出中の車両はその日付に紐付け不可。
    if (resolvedVehicleId) {
      const { data: loan } = await supabase
        .from("vehicle_loans")
        .select("id")
        .eq("vehicle_id", resolvedVehicleId)
        .eq("loan_date", shiftDate)
        .maybeSingle();
      if (loan) {
        return NextResponse.json(
          { error: "この車両は同日が貸出中のため、シフトに紐付けできません。" },
          { status: 409 },
        );
      }
    }

    const upsertRow: Record<string, unknown> = {
      shift_date: shiftDate,
      course_id: courseId,
      slot: slotNumber,
      driver_id: driverId || null,
      updated_at: new Date().toISOString(),
    };
    if (resolvedVehicleId !== undefined) {
      upsertRow.vehicle_id = resolvedVehicleId;
    }
    if ("usesExternalVehicle" in body) {
      upsertRow.uses_external_vehicle = external;
    }

    // Upsert
    const { data, error } = await supabase
      .from("shifts")
      .upsert(upsertRow, { onConflict: "shift_date,course_id,slot" })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ shift: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
