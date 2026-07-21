import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

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
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

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
    // v2 ソース（互換リーダー）。meter_value あり・却下なし、日付→送信時刻 昇順。
    const rows = (
      await loadLegacyDailyRows(supabase, orgId, { start: startParam, end: endParam, vehicleId })
    )
      .filter((r) => r.meter_value != null && !r.rejected_at)
      .sort(
        (a, b) =>
          a.report_date.localeCompare(b.report_date) ||
          String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")),
      );

    const driverIds = Array.from(
      new Set((rows ?? []).map((r: any) => r?.driver_id).filter(Boolean))
    ) as string[];
    const { data: drivers, error: driverErr } = driverIds.length
      ? await supabase
          .from("drivers")
          .select("id, name, display_name")
          .eq("org_id", orgId)
          .in("id", driverIds)
      : { data: [], error: null };
    if (driverErr) {
      console.error("[admin/vehicles/:id/meter-logs] drivers error", driverErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    const driverMap = new Map<string, { id: string; name: string; display_name: string | null }>();
    (drivers ?? []).forEach((d: any) => {
      if (!d?.id) return;
      driverMap.set(String(d.id), {
        id: String(d.id),
        name: String(d.name ?? ""),
        display_name: d.display_name ?? null,
      });
    });

    const logs: MeterLog[] = (rows ?? [])
      .map((r: any) => {
        if (!r?.report_date || r.meter_value == null || !r.driver_id) return null;
        const drv = driverMap.get(String(r.driver_id));
        if (!drv) return null;
        return {
          report_date: String(r.report_date),
          meter_value: Number(r.meter_value),
          driver: drv,
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

