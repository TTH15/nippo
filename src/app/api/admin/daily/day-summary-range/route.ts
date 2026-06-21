import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";
import { loadReportContents } from "@/server/aggregation/reportContent";

export const dynamic = "force-dynamic";

type VehiclePlatePayload = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

function toPlatePayload(v: any): VehiclePlatePayload | null {
  if (!v || !v.id) return null;
  return {
    id: v.id,
    number_prefix: v.number_prefix ?? null,
    number_class: v.number_class ?? null,
    number_hiragana: v.number_hiragana ?? null,
    number_numeric: v.number_numeric ?? null,
    manufacturer: v.manufacturer ?? null,
    brand: v.brand ?? null,
  };
}

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

  // 未来日は対象外にする（指定があっても businessToday までにクランプ）
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
      .select("id, name, display_name")
      .eq("role", "DRIVER")
      .order("name");

    if (driversErr) {
      console.error("[admin/daily/day-summary-range] drivers error", driversErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { data: shiftRows, error: shiftsErr } = await supabase
      .from("shifts")
      .select("shift_date, driver_id, course_id")
      .gte("shift_date", startParam)
      .lte("shift_date", endParam)
      .not("driver_id", "is", null);

    if (shiftsErr) {
      console.error("[admin/daily/day-summary-range] shifts error", shiftsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const shiftsByDate = new Map<string, Set<string>>();
    // 日付×ドライバーごとの担当コース集合（1日複数コースの未提出検出用）
    const shiftCoursesByDate = new Map<string, Map<string, Set<string>>>();
    (shiftRows ?? []).forEach((r: any) => {
      if (!r.shift_date || !r.driver_id) return;
      if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
      shiftsByDate.get(r.shift_date)!.add(r.driver_id);
      if (!r.course_id) return;
      if (!shiftCoursesByDate.has(r.shift_date)) shiftCoursesByDate.set(r.shift_date, new Map());
      const byDriver = shiftCoursesByDate.get(r.shift_date)!;
      if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, new Set());
      byDriver.get(r.driver_id)!.add(r.course_id);
    });

    const driverIds = (drivers ?? []).map((d: { id: string }) => d.id);
    const { data: prefRows } = driverIds.length
      ? await supabase
          .from("driver_vehicle_preferences")
          .select("driver_id, vehicles ( id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand )")
          .in("driver_id", driverIds)
      : { data: [] };
    const driverPreferredVehicle: Record<string, VehiclePlatePayload> = {};
    (prefRows ?? []).forEach((row: any) => {
      const plate = toPlatePayload(row.vehicles);
      if (row.driver_id && plate) driverPreferredVehicle[row.driver_id] = plate;
    });

    let reportRows: Awaited<ReturnType<typeof loadLegacyDailyRows>>;
    try {
      const all = await loadLegacyDailyRows(
        supabase,
        { start: startParam, end: endParam },
        { idSource: "v2", withVehicle: true },
      );
      // 却下済みは同日に残るため、一覧は「未却下」を優先表示
      reportRows = all.filter((r) => !r.rejected_at);
    } catch (e) {
      console.error("[admin/daily/day-summary-range] reports error", e);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    // 内容（送信画面と同じ動的 unit/field 構造）を report_entries から取得
    const contentByReport = await loadReportContents(
      supabase,
      (reportRows ?? []).map((r: any) => r.id).filter(Boolean),
    );

    const reportsByDateDriver = new Map<string, Map<string, any>>();
    (reportRows ?? []).forEach((r: any) => {
      const date = r.report_date;
      const driverId = r.driver_id;
      if (!date || !driverId) return;
      if (!reportsByDateDriver.has(date)) reportsByDateDriver.set(date, new Map());
      const veh = r.vehicles;
      // 1日複数シフト（複数コース）対応: ドライバーごとに配列で保持
      const arr = reportsByDateDriver.get(date)!.get(driverId) ?? [];
      arr.push({
        id: r.id,
        driver_id: r.driver_id,
        report_date: r.report_date,
        course_id: r.course_id ?? null,
        content: contentByReport.get(r.id) ?? [],
        takuhaibin_completed: Number(r.takuhaibin_completed) ?? 0,
        takuhaibin_returned: Number(r.takuhaibin_returned) ?? 0,
        nekopos_completed: Number(r.nekopos_completed) ?? 0,
        nekopos_returned: Number(r.nekopos_returned) ?? 0,
        submitted_at: r.submitted_at ?? "",
        carrier: r.carrier ?? null,
        carrier_id: r.carrier_id ?? null,
        carrier_name: r.carrier_name ?? null,
        approved_at: r.approved_at ?? null,
        rejected_at: r.rejected_at ?? null,
        vehicle_id: r.vehicle_id ?? null,
        meter_value: r.meter_value != null ? Number(r.meter_value) : null,
        vehicle_plate: toPlatePayload(veh),
        amazon_am_mochidashi: r.amazon_am_mochidashi != null ? Number(r.amazon_am_mochidashi) : 0,
        amazon_am_completed: r.amazon_am_completed != null ? Number(r.amazon_am_completed) : 0,
        amazon_pm_mochidashi: r.amazon_pm_mochidashi != null ? Number(r.amazon_pm_mochidashi) : 0,
        amazon_pm_completed: r.amazon_pm_completed != null ? Number(r.amazon_pm_completed) : 0,
        amazon_4_mochidashi: r.amazon_4_mochidashi != null ? Number(r.amazon_4_mochidashi) : 0,
        amazon_4_completed: r.amazon_4_completed != null ? Number(r.amazon_4_completed) : 0,
      });
      reportsByDateDriver.get(date)!.set(driverId, arr);
    });

    const dates: string[] = [];
    const d = new Date(startParam);
    const end = new Date(endParam);
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    dates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

    const days = dates.map((date) => {
      const shiftDriverIds = Array.from(shiftsByDate.get(date) ?? []);
      const reportsMap = reportsByDateDriver.get(date) ?? new Map();
      const reportsByDriver: Record<string, any> = {};
      reportsMap.forEach((v, k) => {
        reportsByDriver[k] = v;
      });
      const shiftCoursesByDriver: Record<string, string[]> = {};
      (shiftCoursesByDate.get(date) ?? new Map<string, Set<string>>()).forEach((courseSet, driverId) => {
        shiftCoursesByDriver[driverId] = Array.from(courseSet);
      });
      return {
        date,
        drivers: drivers ?? [],
        shiftDriverIds,
        shiftCoursesByDriver,
        reportsByDriver,
        driverPreferredVehicle,
      };
    });

    return NextResponse.json({ days });
  } catch (err) {
    console.error("[admin/daily/day-summary-range] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
