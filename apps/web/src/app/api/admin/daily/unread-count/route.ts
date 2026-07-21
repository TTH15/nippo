import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  let startParam = url.searchParams.get("start");
  let endParam = url.searchParams.get("end");
  const businessToday = reportDateDefaultJST();

  if (!startParam || !endParam) {
    // 要対応(未解決)である限り、経過日数に関わらずバッジに出続けるべきなので
    // 既定の遡り幅は広めに取る（未解決以外の日は結果に含まれないため表示は増えない）。
    const end = businessToday;
    const base = new Date(end + "T12:00:00+09:00");
    const start = new Date(base);
    start.setDate(start.getDate() - 89);
    startParam = start.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    endParam = end;
  }

  if (startParam > businessToday) startParam = businessToday;
  if (endParam > businessToday) endParam = businessToday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startParam) || !/^\d{4}-\d{2}-\d{2}$/.test(endParam)) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (startParam > endParam) {
    [startParam, endParam] = [endParam, startParam];
  }

  try {
    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id")
      .eq("works_as_driver", true);
    if (driversErr) {
      console.error("[admin/daily/unread-count] drivers error", driversErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { data: shiftRows, error: shiftsErr } = await supabase
      .from("shifts")
      .select("shift_date, driver_id, course_id")
      .gte("shift_date", startParam)
      .lte("shift_date", endParam)
      .not("driver_id", "is", null);
    if (shiftsErr) {
      console.error("[admin/daily/unread-count] shifts error", shiftsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    let reportRows: {
      report_date: string;
      driver_id: string;
      course_id: string | null;
      approved_at: string | null;
      rejected_at: string | null;
    }[];
    try {
      // バッジの数字を出すだけなので実績値（report_entries）は不要。
      // 既定で結合すると report_id を 200 件ずつ引く重い処理が走る。
      reportRows = await loadLegacyDailyRows(
        supabase,
        { start: startParam, end: endParam },
        { withEntries: false },
      );
    } catch (e) {
      console.error("[admin/daily/unread-count] reports error", e);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const shiftsByDate = new Map<string, Set<string>>();
    // 日付×ドライバーの担当コース集合（1日複数コースの部分未提出を検出するため）
    const shiftCoursesByDate = new Map<string, Map<string, Set<string>>>();
    (shiftRows ?? []).forEach((r: { shift_date: string; driver_id: string; course_id: string | null }) => {
      if (!r.shift_date || !r.driver_id) return;
      if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
      shiftsByDate.get(r.shift_date)!.add(r.driver_id);
      if (!r.course_id) return;
      if (!shiftCoursesByDate.has(r.shift_date)) shiftCoursesByDate.set(r.shift_date, new Map());
      const byDriver = shiftCoursesByDate.get(r.shift_date)!;
      if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, new Set());
      byDriver.get(r.driver_id)!.add(r.course_id);
    });

    // ドライバーごとに非却下レポートを配列で保持（コース単位の未提出/未承認判定用）
    const reportsByDateDriver = new Map<
      string,
      Map<string, { course_id: string | null; approved_at: string | null }[]>
    >();
    (reportRows ?? []).forEach(
      (r: {
        report_date: string;
        driver_id: string;
        course_id: string | null;
        approved_at: string | null;
        rejected_at: string | null;
      }) => {
        if (!r.report_date || !r.driver_id) return;
        if (r.rejected_at) return; // 却下は未提出扱い
        if (!reportsByDateDriver.has(r.report_date)) reportsByDateDriver.set(r.report_date, new Map());
        const byDriver = reportsByDateDriver.get(r.report_date)!;
        const arr = byDriver.get(r.driver_id) ?? [];
        arr.push({ course_id: r.course_id ?? null, approved_at: r.approved_at ?? null });
        byDriver.set(r.driver_id, arr);
      },
    );

    const driverIds = (drivers ?? []).map((d: { id: string }) => d.id);
    const dates: string[] = [];
    const d = new Date(startParam);
    const end = new Date(endParam);
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }

    let unreadCount = 0;
    for (const date of dates) {
      const shifted = shiftsByDate.get(date);
      if (!shifted) continue;
      const reports = reportsByDateDriver.get(date);
      const shiftCourses = shiftCoursesByDate.get(date);
      for (const driverId of driverIds) {
        if (!shifted.has(driverId)) continue;
        const reps = reports?.get(driverId) ?? [];
        if (reps.length === 0) {
          unreadCount += 1; // 日報未提出
          continue;
        }
        const reportedCourses = new Set(reps.map((r) => r.course_id).filter((c): c is string => !!c));
        const courses = shiftCourses?.get(driverId);
        const missing = courses ? Array.from(courses).filter((c) => !reportedCourses.has(c)).length : 0;
        const hasUnapproved = reps.some((r) => !r.approved_at);
        if (missing > 0 || hasUnapproved) {
          unreadCount += 1; // 一部コース未提出 または 未承認
        }
      }
    }

    return NextResponse.json({ unreadCount });
  } catch (err) {
    console.error("[admin/daily/unread-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
