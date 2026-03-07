import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function vehicleLabel(v: { manufacturer?: string | null; brand?: string | null; number_numeric?: string | null } | null): string | null {
  if (!v) return null;
  const parts = [v.manufacturer, v.brand, v.number_numeric].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
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

    const { data: reportRows, error: reportsErr } = await supabase
      .from("daily_reports")
      .select(`
        id, driver_id, report_date, takuhaibin_completed, takuhaibin_returned,
        nekopos_completed, nekopos_returned, submitted_at, carrier, approved_at, rejected_at,
        vehicle_id, meter_value,
        amazon_am_mochidashi, amazon_am_completed, amazon_pm_mochidashi, amazon_pm_completed,
        amazon_4_mochidashi, amazon_4_completed,
        vehicles ( manufacturer, brand, number_numeric )
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
        vehicle_label: string | null;
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
        vehicle_label: vehicleLabel(veh),
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
    });
  } catch (err) {
    console.error("[admin/daily/day-summary] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
