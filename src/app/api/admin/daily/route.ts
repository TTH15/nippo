import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const date = req.nextUrl.searchParams.get("date") || todayJST();

  // All drivers
  const { data: drivers, error: dErr } = await supabase
    .from("drivers")
    .select("id, name, display_name")
    .eq("role", "DRIVER")
    .order("name");

  if (dErr) throw dErr;

  // Reports for this date
  const { data: reports, error: rErr } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("report_date", date);

  if (rErr) throw rErr;

  const reportMap = new Map(reports?.map((r) => [r.driver_id, r]));

  const result = (drivers ?? []).map((d) => ({
    driver: { id: d.id, name: d.name, display_name: d.display_name ?? null },
    report: reportMap.get(d.id) ?? null,
  }));

  return NextResponse.json({ date, entries: result });
}
