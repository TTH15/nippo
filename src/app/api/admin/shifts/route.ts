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
      id, shift_date, course_id, slot, driver_id, vehicle_id,
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

  // Get shift requests (希望休)
  const { data: requests } = await supabase
    .from("shift_requests")
    .select("*")
    .gte("request_date", startDate)
    .lte("request_date", endDate);

  return NextResponse.json({
    courses: courses ?? [],
    shifts: shifts ?? [],
    drivers: drivers ?? [],
    requests: requests ?? [],
    vehicles: fleet ?? [],
    vehicle_driver_links: vehicleLinks ?? [],
  });
}

// POST: シフト登録/更新
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { shiftDate, courseId, driverId, slot, vehicleId } = body as {
      shiftDate?: string;
      courseId?: string;
      driverId?: string | null;
      slot?: number;
      /** 明示的に null で車両のみクリアすることも許可 */
      vehicleId?: string | null;
    };

    if (!shiftDate || !courseId) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;

    let resolvedVehicleId: string | null | undefined = undefined;
    if ("vehicleId" in body) {
      resolvedVehicleId = vehicleId && typeof vehicleId === "string" ? vehicleId : null;
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
