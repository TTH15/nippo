import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * 指定日・勤務区分の日報ドラフト取得 + その日・その区分のコースに紐づくシフト（走行コース表示用）
 */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const driverIdentityId = req.nextUrl.searchParams.get("driverIdentityId");
  const reportDate = req.nextUrl.searchParams.get("reportDate");

  if (!driverIdentityId || typeof driverIdentityId !== "string") {
    return NextResponse.json({ error: "driverIdentityId が必要です" }, { status: 400 });
  }
  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return NextResponse.json({ error: "reportDate (YYYY-MM-DD) が必要です" }, { status: 400 });
  }

  const { data: identity, error: idErr } = await supabase
    .from("driver_identities")
    .select("id, driver_id, slot, driver_code, office_code, label")
    .eq("id", driverIdentityId)
    .eq("driver_id", user.driverId)
    .single();

  if (idErr || !identity) {
    return NextResponse.json({ error: "勤務区分が見つかりません" }, { status: 404 });
  }

  const { data: report } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("driver_identity_id", driverIdentityId)
    .eq("report_date", reportDate)
    .maybeSingle();

  const { data: courseRows } = await supabase
    .from("driver_courses")
    .select("course_id")
    .eq("driver_identity_id", driverIdentityId);

  const courseIds = (courseRows ?? []).map((r: { course_id: string }) => r.course_id);
  if (courseIds.length === 0) {
    return NextResponse.json({
      report: report ?? null,
      shiftsToday: [] as { course_id: string; name: string; color: string }[],
    });
  }

  const { data: shifts } = await supabase
    .from("shifts")
    .select("course_id")
    .eq("shift_date", reportDate)
    .eq("driver_id", user.driverId)
    .in("course_id", courseIds);

  const shiftCourseIds = Array.from(new Set((shifts ?? []).map((s: { course_id: string }) => s.course_id)));

  if (shiftCourseIds.length === 0) {
    return NextResponse.json({
      report: report ?? null,
      shiftsToday: [] as { course_id: string; name: string; color: string }[],
    });
  }

  const { data: courses } = await supabase
    .from("courses")
    .select("id, name, color")
    .in("id", shiftCourseIds)
    .order("sort_order");

  const shiftsToday = (courses ?? []).map((c: { id: string; name: string; color: string }) => ({
    course_id: c.id,
    name: c.name,
    color: c.color,
  }));

  return NextResponse.json({
    report: report ?? null,
    shiftsToday,
  });
}
