import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 指定期間のシフト取得
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
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

  // Get shifts for date range
  const { data: shifts } = await supabase
    .from("shifts")
    .select(`
      id, shift_date, course_id, driver_id,
      drivers (id, name)
    `)
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  // Get drivers with their course assignments
  const { data: drivers } = await supabase
    .from("drivers")
    .select(`
      id, name, role,
      driver_courses (course_id)
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
  });
}

// POST: シフト登録/更新
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { shiftDate, courseId, driverId } = body;

    if (!shiftDate || !courseId) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    // Upsert
    const { data, error } = await supabase
      .from("shifts")
      .upsert(
        {
          shift_date: shiftDate,
          course_id: courseId,
          driver_id: driverId || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shift_date,course_id" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ shift: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
