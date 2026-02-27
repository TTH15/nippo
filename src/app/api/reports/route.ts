import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import { bus, DailyReportSubmittedPayload } from "@/server/events/bus";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const carrier: "YAMATO" | "AMAZON" = body.carrier === "AMAZON" ? "AMAZON" : "YAMATO";

    const takuhaibinCompleted = Number(body.takuhaibinCompleted) || 0;
    const takuhaibinReturned = Number(body.takuhaibinReturned) || 0;
    const nekoposCompleted = Number(body.nekoposCompleted) || 0;
    const nekoposReturned = Number(body.nekoposReturned) || 0;

    const amazonAmMochidashi = Number(body.amazonAmMochidashi) || 0;
    const amazonAmCompleted = Number(body.amazonAmCompleted) || 0;
    const amazonPmMochidashi = Number(body.amazonPmMochidashi) || 0;
    const amazonPmCompleted = Number(body.amazonPmCompleted) || 0;
    const amazon4Mochidashi = Number(body.amazon4Mochidashi) || 0;
    const amazon4Completed = Number(body.amazon4Completed) || 0;
    const vehicleId = body.vehicleId ?? null;
    const meterValue = body.meterValue != null ? Number(body.meterValue) : null;

    // Validate non-negative integers
    const yamatoValues = [takuhaibinCompleted, takuhaibinReturned, nekoposCompleted, nekoposReturned];
    const amazonValues = [
      amazonAmMochidashi,
      amazonAmCompleted,
      amazonPmMochidashi,
      amazonPmCompleted,
      amazon4Mochidashi,
      amazon4Completed,
    ];

    const allValues = carrier === "AMAZON" ? amazonValues : yamatoValues;

    if (allValues.some((v) => v < 0 || !Number.isInteger(v))) {
      return NextResponse.json({ error: "Values must be non-negative integers" }, { status: 400 });
    }

    if (meterValue != null && (meterValue < 0 || !Number.isInteger(meterValue))) {
      return NextResponse.json({ error: "Meter value must be non-negative integer" }, { status: 400 });
    }

    const reportDate = todayJST();

    // 車両のメーター値を更新
    if (vehicleId && meterValue != null) {
      await supabase
        .from("vehicles")
        .update({ current_mileage: meterValue, updated_at: new Date().toISOString() })
        .eq("id", vehicleId);
    }

    // Upsert
    const { data, error } = await supabase
      .from("daily_reports")
      .upsert(
        {
          driver_id: user.driverId,
          report_date: reportDate,
          carrier,
          takuhaibin_completed: carrier === "YAMATO" ? takuhaibinCompleted : 0,
          takuhaibin_returned: carrier === "YAMATO" ? takuhaibinReturned : 0,
          nekopos_completed: carrier === "YAMATO" ? nekoposCompleted : 0,
          nekopos_returned: carrier === "YAMATO" ? nekoposReturned : 0,
          amazon_am_mochidashi: carrier === "AMAZON" ? amazonAmMochidashi : 0,
          amazon_am_completed: carrier === "AMAZON" ? amazonAmCompleted : 0,
          amazon_pm_mochidashi: carrier === "AMAZON" ? amazonPmMochidashi : 0,
          amazon_pm_completed: carrier === "AMAZON" ? amazonPmCompleted : 0,
          amazon_4_mochidashi: carrier === "AMAZON" ? amazon4Mochidashi : 0,
          amazon_4_completed: carrier === "AMAZON" ? amazon4Completed : 0,
          vehicle_id: vehicleId,
          meter_value: meterValue,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "driver_id,report_date" }
      )
      .select()
      .single();

    if (error) throw error;

    // Fetch driver name for event payload
    const { data: driver } = await supabase
      .from("drivers")
      .select("name")
      .eq("id", user.driverId)
      .single();

    // Emit event (non-blocking)
    const payload: DailyReportSubmittedPayload = {
      driverId: user.driverId,
      driverName: driver?.name ?? "Unknown",
      reportDate,
      takuhaibinCompleted: carrier === "YAMATO" ? takuhaibinCompleted : 0,
      takuhaibinReturned: carrier === "YAMATO" ? takuhaibinReturned : 0,
      nekoposCompleted: carrier === "YAMATO" ? nekoposCompleted : 0,
      nekoposReturned: carrier === "YAMATO" ? nekoposReturned : 0,
      submittedAt: data.submitted_at,
    };
    bus.emit("daily_report_submitted", payload);

    return NextResponse.json({ ok: true, report: data });
  } catch (err) {
    console.error("Report submit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
