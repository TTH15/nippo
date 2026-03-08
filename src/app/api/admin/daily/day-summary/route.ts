import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

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

  const dateParam = req.nextUrl.searchParams.get("date");
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });
  }

  try {
    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id, name, display_name")
      .eq("role", "DRIVER")
      .order("name");

    if (driversErr) {
      console.error("[admin/daily/day-summary] drivers error", driversErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { data: shiftRows, error: shiftsErr } = await supabase
      .from("shifts")
      .select("driver_id")
      .eq("shift_date", dateParam)
      .not("driver_id", "is", null);

    if (shiftsErr) {
      console.error("[admin/daily/day-summary] shifts error", shiftsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const shiftDriverIds = Array.from(
      new Set((shiftRows ?? []).map((r: { driver_id: string }) => r.driver_id).filter(Boolean))
    );

    // 未提出でも表示するため、ドライバーごとの予定車両（最終選択車両）を取得（ナンバープレート用）
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
      .eq("report_date", dateParam);

    if (reportsErr) {
      console.error("[admin/daily/day-summary] reports error", reportsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const reportsByDriver: Record<
      string,
      {
        id: string;
        driver_id: string;
        report_date: string;
        takuhaibin_completed: number;
        takuhaibin_returned: number;
        nekopos_completed: number;
        nekopos_returned: number;
        submitted_at: string;
        carrier: string | null;
        approved_at: string | null;
        rejected_at: string | null;
        vehicle_id: string | null;
        meter_value: number | null;
        vehicle_plate: VehiclePlatePayload | null;
        amazon_am_mochidashi?: number;
        amazon_am_completed?: number;
        amazon_pm_mochidashi?: number;
        amazon_pm_completed?: number;
        amazon_4_mochidashi?: number;
        amazon_4_completed?: number;
      }
    > = {};

    (reportRows ?? []).forEach((r: any) => {
      const driverId = r.driver_id;
      if (!driverId) return;
      const veh = r.vehicles;
      reportsByDriver[driverId] = {
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
      };
    });

    return NextResponse.json({
      date: dateParam,
      drivers: drivers ?? [],
      shiftDriverIds,
      reportsByDriver,
      driverPreferredVehicle,
    });
  } catch (err) {
    console.error("[admin/daily/day-summary] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
