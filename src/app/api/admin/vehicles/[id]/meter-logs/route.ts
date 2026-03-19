import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";

export const dynamic = "force-dynamic";

type MeterLog = {
  report_date: string;
  meter_value: number;
  driver: { id: string; name: string; display_name: string | null };
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await ctx.params;
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicle id required" }, { status: 400 });
  }

  const url = req.nextUrl;
  let startParam = url.searchParams.get("start");
  let endParam = url.searchParams.get("end");
  const businessToday = reportDateDefaultJST();

  if (!startParam || !endParam) {
    const end = businessToday;
    const base = new Date(end + "T12:00:00+09:00");
    const start = new Date(base);
    start.setDate(start.getDate() - 29);
    startParam = start.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    endParam = end;
  }

  // clamp future
  if (startParam > businessToday) startParam = businessToday;
  if (endParam > businessToday) endParam = businessToday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startParam) || !/^\d{4}-\d{2}-\d{2}$/.test(endParam)) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (startParam > endParam) [startParam, endParam] = [endParam, startParam];

  try {
    const { data: rows, error } = await supabase
      .from("daily_reports")
      .select(
        `
        report_date,
        meter_value,
        driver_id,
        drivers ( id, name, display_name )
      `
      )
      .eq("vehicle_id", vehicleId)
      .gte("report_date", startParam)
      .lte("report_date", endParam)
      .not("meter_value", "is", null)
      .is("rejected_at", null)
      .order("report_date", { ascending: true })
      .order("submitted_at", { ascending: true });

    if (error) {
      console.error("[admin/vehicles/:id/meter-logs] db error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const logs: MeterLog[] = (rows ?? [])
      .map((r: any) => {
        const drv = r.drivers;
        if (!r.report_date || r.meter_value == null || !drv?.id) return null;
        return {
          report_date: String(r.report_date),
          meter_value: Number(r.meter_value),
          driver: {
            id: String(drv.id),
            name: String(drv.name ?? ""),
            display_name: drv.display_name ?? null,
          },
        } satisfies MeterLog;
      })
      .filter(Boolean) as MeterLog[];

    return NextResponse.json({
      vehicleId,
      start: startParam,
      end: endParam,
      logs,
    });
  } catch (err) {
    console.error("[admin/vehicles/:id/meter-logs] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

