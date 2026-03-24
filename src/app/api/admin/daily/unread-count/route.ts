import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  let startParam = url.searchParams.get("start");
  let endParam = url.searchParams.get("end");
  const businessToday = reportDateDefaultJST();

  if (!startParam || !endParam) {
    const end = businessToday;
    const base = new Date(end + "T12:00:00+09:00");
    const start = new Date(base);
    start.setDate(start.getDate() - 13);
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
      .eq("role", "DRIVER");
    if (driversErr) {
      console.error("[admin/daily/unread-count] drivers error", driversErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { data: shiftRows, error: shiftsErr } = await supabase
      .from("shifts")
      .select("shift_date, driver_id")
      .gte("shift_date", startParam)
      .lte("shift_date", endParam)
      .not("driver_id", "is", null);
    if (shiftsErr) {
      console.error("[admin/daily/unread-count] shifts error", shiftsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { data: reportRows, error: reportsErr } = await supabase
      .from("daily_reports")
      .select("report_date, driver_id, approved_at, rejected_at")
      .gte("report_date", startParam)
      .lte("report_date", endParam);
    if (reportsErr) {
      console.error("[admin/daily/unread-count] reports error", reportsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const shiftsByDate = new Map<string, Set<string>>();
    (shiftRows ?? []).forEach((r: { shift_date: string; driver_id: string }) => {
      if (!r.shift_date || !r.driver_id) return;
      if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
      shiftsByDate.get(r.shift_date)!.add(r.driver_id);
    });

    const reportsByDateDriver = new Map<string, Map<string, { approved_at: string | null; rejected_at: string | null }>>();
    (reportRows ?? []).forEach((r: { report_date: string; driver_id: string; approved_at: string | null; rejected_at: string | null }) => {
      if (!r.report_date || !r.driver_id) return;
      if (!reportsByDateDriver.has(r.report_date)) reportsByDateDriver.set(r.report_date, new Map());
      reportsByDateDriver.get(r.report_date)!.set(r.driver_id, {
        approved_at: r.approved_at ?? null,
        rejected_at: r.rejected_at ?? null,
      });
    });

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
      for (const driverId of driverIds) {
        if (!shifted.has(driverId)) continue;
        const report = reports?.get(driverId);
        if (!report) {
          unreadCount += 1; // 日報未提出
          continue;
        }
        if (!report.approved_at && !report.rejected_at) {
          unreadCount += 1; // 日報未承認
        }
      }
    }

    return NextResponse.json({ unreadCount });
  } catch (err) {
    console.error("[admin/daily/unread-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
