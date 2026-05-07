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
      .select("driver_id, report_date, report_kind, description, expense_amount, vehicle_id, odometer_km")
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

    if (
      report?.report_kind === "expense" &&
      report?.driver_id &&
      report?.report_date &&
      report?.expense_amount != null
    ) {
      const month = String(report.report_date).slice(0, 7);
      const amountYen = Math.trunc(Number(report.expense_amount) || 0);
      if (month.match(/^\d{4}-\d{2}$/) && amountYen > 0) {
        const rawTitle = String(report.description ?? "").trim();
        const title = rawTitle ? `経費報告: ${rawTitle}` : "経費報告";
        const name = title.length > 200 ? title.slice(0, 200) : title;
        const { error: adHocErr } = await supabase
          .from("driver_ad_hoc_expenses")
          .upsert({
            driver_id: report.driver_id,
            month,
            name,
            // ペイメントでは控除(+)を差し引く設計のため、加算は負値で保持する
            amount: -amountYen,
            misc_report_id: id,
            updated_at: new Date().toISOString(),
          }, { onConflict: "misc_report_id" });
        if (adHocErr) {
          console.error("[admin/misc-reports/oil-change/approve] ad hoc insert error", adHocErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change/approve] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
