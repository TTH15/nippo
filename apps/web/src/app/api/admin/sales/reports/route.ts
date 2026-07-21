import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

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
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const driverIdParam = url.searchParams.get("driver_id");
  const driverId = driverIdParam?.trim() || "";

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

  const driversQuery = supabase
    .from("drivers")
    .select("id, name, display_name, role")
    .eq("org_id", orgId)
    .eq("works_as_driver", true)
    .order("name");
  const { data: drivers, error: dErr } = await driversQuery;

  if (dErr) {
    console.error(dErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 集計表には承認済みの日報のみを含める（v2 ソース・互換リーダー）。
  // ※ Amazon 行の宅急便/ネコポス列は旧テーブルでは残骸が入っていたが、v2 では正しく 0。
  let reports: ReportRow[];
  try {
    const rows = await loadLegacyDailyRows(supabase, orgId, {
      start: startDate,
      end: endDate,
      driverId: driverId || undefined,
    });
    reports = rows
      .filter((r) => r.approved_at != null)
      .map((r) => ({
        driver_id: r.driver_id,
        report_date: r.report_date,
        takuhaibin_completed: r.takuhaibin_completed,
        takuhaibin_returned: r.takuhaibin_returned,
        nekopos_completed: r.nekopos_completed,
        nekopos_returned: r.nekopos_returned,
      }));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Amazonミッドナイト判定用にコースとシフトを取得
  // コースはテナント固有マスタ。他社コースが集計タブに出ないよう org で絞る
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name, carrier, summary_title")
    .eq("org_id", orgId);
  const courseNameMap = new Map<string, string>();
  const courseSummaryMap = new Map<string, string>();
  (courses ?? []).forEach((c: any) => {
    if (c.id && c.name) courseNameMap.set(c.id, c.name);
    if (c.id && c.summary_title) courseSummaryMap.set(c.id, c.summary_title);
  });

  let shiftsQuery = supabase
    .from("shifts")
    .select("shift_date, driver_id, course_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);
  if (driverId) shiftsQuery = shiftsQuery.eq("driver_id", driverId);
  const { data: shifts, error: sErr } = await shiftsQuery;

  if (sErr) {
    console.error(sErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const filteredReports: ReportRow[] = (reports ?? []) as ReportRow[];

  const midnights: MidnightRow[] = [];
  const courseShifts: Record<string, { driver_id: string; date: string }[]> = {};

  (shifts ?? []).forEach((s: any) => {
    if (!s.driver_id || !s.course_id) return;
    const name = courseNameMap.get(s.course_id);
    if (name === "Amazonミッドナイト") {
      midnights.push({ driver_id: s.driver_id, date: s.shift_date });
    }
    // 略記（summary_title）が設定されているコースのシフトを按コースで集約
    if (courseSummaryMap.has(s.course_id)) {
      const list = courseShifts[s.course_id] ?? [];
      list.push({ driver_id: s.driver_id, date: s.shift_date });
      courseShifts[s.course_id] = list;
    }
  });

  // 集計タブで表示するコース（略記が設定されているもの）
  const summaryCourses = (courses ?? []).filter(
    (c: any) => c.summary_title
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

