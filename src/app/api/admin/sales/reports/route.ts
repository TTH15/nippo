import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type DriverRow = { id: string; name: string; display_name?: string | null };
type ReportRow = {
  driver_id: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
};

type MidnightRow = {
  driver_id: string;
  date: string;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  let startDate: string;
  let endDate: string;
  let month: string | null = null;

  if (startParam && endParam) {
    startDate = startParam;
    endDate = endParam;
  } else {
    month = url.searchParams.get("month") || "";
    const [year, mon] = month
      ? month.split("-").map(Number)
      : [new Date().getFullYear(), new Date().getMonth() + 1];
    startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  const { data: drivers, error: dErr } = await supabase
    .from("drivers")
    .select("id, name, display_name, role")
    .eq("role", "DRIVER")
    .order("name");

  if (dErr) {
    console.error(dErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const { data: reports, error: rErr } = await supabase
    .from("daily_reports")
    .select(
      "driver_id, report_date, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned",
    )
    .gte("report_date", startDate)
    .lte("report_date", endDate);

  if (rErr) {
    console.error(rErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Amazonミッドナイト判定用にコースとシフトを取得
  const { data: courses } = await supabase.from("courses").select("id, name");
  const courseNameMap = new Map<string, string>();
  (courses ?? []).forEach((c: any) => {
    if (c.id && c.name) courseNameMap.set(c.id, c.name);
  });

  const { data: shifts, error: sErr } = await supabase
    .from("shifts")
    .select("shift_date, driver_id, course_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  if (sErr) {
    console.error(sErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const midnights: MidnightRow[] = [];
  (shifts ?? []).forEach((s: any) => {
    if (!s.driver_id || !s.course_id) return;
    const name = courseNameMap.get(s.course_id);
    if (name === "Amazonミッドナイト") {
      midnights.push({ driver_id: s.driver_id, date: s.shift_date });
    }
  });

  return NextResponse.json({
    month,
    startDate,
    endDate,
    drivers: (drivers ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      display_name: d.display_name ?? null,
    })) as DriverRow[],
    reports: (reports ?? []) as ReportRow[],
    midnights,
  });
}

