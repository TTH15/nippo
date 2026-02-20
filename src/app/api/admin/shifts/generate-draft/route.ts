import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type DriverRow = {
  id: string;
  name: string;
  driver_courses: { course_id: string }[];
};

/**
 * 希望休・配送可能ルートを踏まえてシフトの叩き台を生成し、DBに反映する。
 * 各 (日付, コース) に対して、そのコースを担当可能で希望休でないドライバーを1名割り当てる。
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { start: startDate, end: endDate } = body as { start?: string; end?: string };

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "start and end are required" },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const [coursesRes, driversRes, requestsRes] = await Promise.all([
      supabase.from("courses").select("id").order("sort_order"),
      supabase
        .from("drivers")
        .select("id, name, driver_courses(course_id)")
        .eq("role", "DRIVER")
        .order("name"),
      supabase
        .from("shift_requests")
        .select("driver_id, request_date")
        .gte("request_date", startDate)
        .lte("request_date", endDate),
    ]);

    const courses = coursesRes.data ?? [];
    const drivers = (driversRes.data ?? []) as DriverRow[];
    const requests = requestsRes.data ?? [];

    const offByDate = new Map<string, Set<string>>();
    requests.forEach((r: { driver_id: string; request_date: string }) => {
      if (!offByDate.has(r.request_date)) offByDate.set(r.request_date, new Set());
      offByDate.get(r.request_date)!.add(r.driver_id);
    });

    const driverByCourse = new Map<string, string[]>();
    drivers.forEach((d) => {
      (d.driver_courses ?? []).forEach((dc: { course_id: string }) => {
        if (!driverByCourse.has(dc.course_id)) driverByCourse.set(dc.course_id, []);
        driverByCourse.get(dc.course_id)!.push(d.id);
      });
    });

    const assignments: { shift_date: string; course_id: string; driver_id: string | null }[] = [];
    const assignedByDate = new Map<string, Set<string>>();

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const offToday = offByDate.get(dateStr) ?? new Set();
      const assignedToday = new Set<string>();

      for (const course of courses) {
        const candidateIds = driverByCourse.get(course.id) ?? [];
        const available = candidateIds.filter(
          (id) => !offToday.has(id) && !assignedToday.has(id)
        );
        const chosen = available[0] ?? null;
        if (chosen) {
          assignedToday.add(chosen);
          assignments.push({
            shift_date: dateStr,
            course_id: course.id,
            driver_id: chosen,
          });
        } else {
          assignments.push({
            shift_date: dateStr,
            course_id: course.id,
            driver_id: null,
          });
        }
      }
      assignedByDate.set(dateStr, assignedToday);
    }

    const toUpsert = assignments.map((a) => ({
      shift_date: a.shift_date,
      course_id: a.course_id,
      driver_id: a.driver_id ?? null,
      updated_at: new Date().toISOString(),
    }));

    if (toUpsert.length === 0) {
      return NextResponse.json({ applied: 0, message: "No shifts to apply" });
    }

    const { error } = await supabase
      .from("shifts")
      .upsert(toUpsert, { onConflict: "shift_date,course_id" });

    if (error) throw error;

    return NextResponse.json({
      applied: toUpsert.filter((u) => u.driver_id != null).length,
      total: toUpsert.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
