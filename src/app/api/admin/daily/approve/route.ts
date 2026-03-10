import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const driverId = String(body.driverId ?? "");
    const date = String(body.date ?? "");

    if (!driverId || !date) {
      return NextResponse.json({ error: "driverId and date are required" }, { status: 400 });
    }

    // 承認時に「その日報に紐づくメーター値」を車両へ反映する（提出時点では反映しない）
    const { data: report, error: reportErr } = await supabase
      .from("daily_reports")
      .select("vehicle_id, meter_value")
      .eq("driver_id", driverId)
      .eq("report_date", date)
      .maybeSingle();

    if (reportErr) {
      console.error(reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (report?.vehicle_id && report.meter_value != null) {
      const { error: vehicleErr } = await supabase
        .from("vehicles")
        .update({ current_mileage: Number(report.meter_value), updated_at: new Date().toISOString() })
        .eq("id", report.vehicle_id);
      if (vehicleErr) {
        console.error(vehicleErr);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
    }

    const { error } = await supabase
      .from("daily_reports")
      .update({
        approved_at: new Date().toISOString(),
        approved_by: user.driverId,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("driver_id", driverId)
      .eq("report_date", date);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

