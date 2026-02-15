import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import { bus, DailyReportSubmittedPayload } from "@/server/events/bus";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const takuhaibinCompleted = Number(body.takuhaibinCompleted) || 0;
    const takuhaibinReturned = Number(body.takuhaibinReturned) || 0;
    const nekoposCompleted = Number(body.nekoposCompleted) || 0;
    const nekoposReturned = Number(body.nekoposReturned) || 0;

    // Validate non-negative integers
    if (
      [takuhaibinCompleted, takuhaibinReturned, nekoposCompleted, nekoposReturned].some(
        (v) => v < 0 || !Number.isInteger(v)
      )
    ) {
      return NextResponse.json({ error: "Values must be non-negative integers" }, { status: 400 });
    }

    const reportDate = todayJST();

    // Upsert
    const { data, error } = await supabase
      .from("daily_reports")
      .upsert(
        {
          driver_id: user.driverId,
          report_date: reportDate,
          takuhaibin_completed: takuhaibinCompleted,
          takuhaibin_returned: takuhaibinReturned,
          nekopos_completed: nekoposCompleted,
          nekopos_returned: nekoposReturned,
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
      takuhaibinCompleted,
      takuhaibinReturned,
      nekoposCompleted,
      nekoposReturned,
      submittedAt: data.submitted_at,
    };
    bus.emit("daily_report_submitted", payload);

    return NextResponse.json({ ok: true, report: data });
  } catch (err) {
    console.error("Report submit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
