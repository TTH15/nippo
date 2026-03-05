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
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  // DB から取得する生データの範囲（シード期間に合わせて十分広く取る）
  const RAW_START = "2025-01-01";
  const RAW_END = "2026-12-31";

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

  // 集計表には承認済みの日報のみを含める
  const { data: reports, error: rErr } = await supabase
    .from("daily_reports")
    .select(
      "driver_id, report_date, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned",
    )
    .gte("report_date", RAW_START)
    .lte("report_date", RAW_END)
    .not("approved_at", "is", null);

  if (rErr) {
    console.error(rErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Amazonミッドナイト判定用にコースとシフトを取得
  const { data: courses } = await supabase.from("courses").select("id, name, carrier, summary_title");
  const courseNameMap = new Map<string, string>();
  (courses ?? []).forEach((c: any) => {
    if (c.id && c.name) courseNameMap.set(c.id, c.name);
  });

  const { data: shifts, error: sErr } = await supabase
    .from("shifts")
    .select("shift_date, driver_id, course_id")
    .gte("shift_date", RAW_START)
    .lte("shift_date", RAW_END);

  if (sErr) {
    console.error(sErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 指定範囲内のレコードだけに絞り込む
  const filteredReports: ReportRow[] =
    (reports ?? []).filter(
      (r: any) => r.report_date >= startDate && r.report_date <= endDate,
    ) as ReportRow[];

  const midnights: MidnightRow[] = [];
  const courseShifts: Record<string, { driver_id: string; date: string }[]> = {};

  (shifts ?? []).forEach((s: any) => {
    if (!s.driver_id || !s.course_id) return;
    if (s.shift_date < startDate || s.shift_date > endDate) return;
    const name = courseNameMap.get(s.course_id);
    if (name === "Amazonミッドナイト") {
      midnights.push({ driver_id: s.driver_id, date: s.shift_date });
    }
    // 集計表示タイトルが設定されているコースのシフトを按コースで集約
    const course = (courses ?? []).find((c: any) => c.id === s.course_id);
    if (course?.carrier === "AMAZON" && course?.summary_title) {
      const list = courseShifts[s.course_id] ?? [];
      list.push({ driver_id: s.driver_id, date: s.shift_date });
      courseShifts[s.course_id] = list;
    }
  });

  // 集計タブで表示するコース（キャリア=Amazon かつ summary_title 設定あり）
  const summaryCourses = (courses ?? []).filter(
    (c: any) => c.carrier === "AMAZON" && c.summary_title
  ).map((c: any) => ({ id: c.id, name: c.name, summary_title: c.summary_title }));

  return NextResponse.json({
    month,
    startDate,
    endDate,
    drivers: (drivers ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      display_name: d.display_name ?? null,
    })) as DriverRow[],
    reports: filteredReports,
    midnights,
    summaryCourses,
    courseShifts,
  });
}

