import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { data: report, error: reportErr } = await supabase
      .from("oil_change_reports")
      .select("vehicle_id, odometer_km, report_kind")
      .eq("id", id)
      .maybeSingle();

    if (reportErr) {
      console.error("[admin/misc-reports/oil-change/approve] report error", reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { error } = await supabase
      .from("oil_change_reports")
      .update({
        approved_at: new Date().toISOString(),
        approved_by: user.driverId,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("id", id);

    if (error) {
      console.error("[admin/misc-reports/oil-change/approve] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (
      report?.report_kind === "oil_change" &&
      report?.vehicle_id &&
      report.odometer_km != null
    ) {
      const { error: vehicleErr } = await supabase
        .from("vehicles")
        .update({
          last_oil_change_mileage: Number(report.odometer_km),
          updated_at: new Date().toISOString(),
        })
        .eq("id", report.vehicle_id);
      if (vehicleErr) {
        console.error("[admin/misc-reports/oil-change/approve] vehicle update error", vehicleErr);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change/approve] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
