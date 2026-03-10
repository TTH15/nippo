import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";

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
      .select("shift_date, driver_id")
      .gte("shift_date", startParam)
      .lte("shift_date", endParam)
      .not("driver_id", "is", null);

    if (shiftsErr) {
      console.error("[admin/daily/day-summary-range] shifts error", shiftsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const shiftsByDate = new Map<string, Set<string>>();
    (shiftRows ?? []).forEach((r: any) => {
      if (!r.shift_date || !r.driver_id) return;
      if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
      shiftsByDate.get(r.shift_date)!.add(r.driver_id);
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

    const { data: reportRows, error: reportsErr } = await supabase
      .from("daily_reports")
      .select(`
        id, driver_id, report_date, takuhaibin_completed, takuhaibin_returned,
        nekopos_completed, nekopos_returned, submitted_at, carrier, approved_at, rejected_at,
        vehicle_id, meter_value,
        amazon_am_mochidashi, amazon_am_completed, amazon_pm_mochidashi, amazon_pm_completed,
        amazon_4_mochidashi, amazon_4_completed,
        vehicles ( id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand )
      `)
      .gte("report_date", startParam)
      .lte("report_date", endParam);

    if (reportsErr) {
      console.error("[admin/daily/day-summary-range] reports error", reportsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const reportsByDateDriver = new Map<string, Map<string, any>>();
    (reportRows ?? []).forEach((r: any) => {
      const date = r.report_date;
      const driverId = r.driver_id;
      if (!date || !driverId) return;
      if (!reportsByDateDriver.has(date)) reportsByDateDriver.set(date, new Map());
      const veh = r.vehicles;
      reportsByDateDriver.get(date)!.set(driverId, {
        id: r.id,
        driver_id: r.driver_id,
        report_date: r.report_date,
        takuhaibin_completed: Number(r.takuhaibin_completed) ?? 0,
        takuhaibin_returned: Number(r.takuhaibin_returned) ?? 0,
        nekopos_completed: Number(r.nekopos_completed) ?? 0,
        nekopos_returned: Number(r.nekopos_returned) ?? 0,
        submitted_at: r.submitted_at ?? "",
        carrier: r.carrier ?? null,
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
      return {
        date,
        drivers: drivers ?? [],
        shiftDriverIds,
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
