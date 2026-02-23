import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type CourseRate = {
  course_id: string;
  takuhaibin_revenue: number;
  takuhaibin_profit: number;
  nekopos_revenue: number;
  nekopos_profit: number;
  fixed_revenue: number;
  fixed_profit: number;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month") || "";
  const [year, mon] = month ? month.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data: courseRates } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_revenue, takuhaibin_profit, nekopos_revenue, nekopos_profit, fixed_revenue, fixed_profit");

  const { data: courses } = await supabase.from("courses").select("id, name");
  const courseNameMap = Object.fromEntries((courses ?? []).map((c) => [c.id, c.name]));
  const rateByCourse = Object.fromEntries(
    (courseRates ?? []).map((r) => [r.course_id, r as CourseRate])
  );

  const { data: shifts } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  const { data: reports } = await supabase
    .from("daily_reports")
    .select("driver_id, report_date, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned")
    .gte("report_date", startDate)
    .lte("report_date", endDate);

  type ReportRow = NonNullable<typeof reports>[number];
  const reportMap = new Map<string, ReportRow>();
  reports?.forEach((r) => reportMap.set(`${r.driver_id}:${r.report_date}`, r));

  const dateMap = new Map<string, { yamato: number; amazon: number; profit: number }>();

  shifts?.forEach((s) => {
    const date = s.shift_date;
    if (!dateMap.has(date)) dateMap.set(date, { yamato: 0, amazon: 0, profit: 0 });
    const entry = dateMap.get(date)!;
    const rate = rateByCourse[s.course_id];
    const courseName = courseNameMap[s.course_id] ?? "";

    if (courseName === "Amazonミッドナイト" && rate) {
      entry.amazon += rate.fixed_revenue;
      entry.profit += rate.fixed_profit;
    } else if (rate && (rate.takuhaibin_revenue > 0 || rate.nekopos_revenue > 0)) {
      const rep = reportMap.get(`${s.driver_id}:${date}`);
      const tkComp = rep?.takuhaibin_completed ?? 0;
      const nkComp = rep?.nekopos_completed ?? 0;
      entry.yamato += tkComp * rate.takuhaibin_revenue + nkComp * rate.nekopos_revenue;
      entry.profit += tkComp * rate.takuhaibin_profit + nkComp * rate.nekopos_profit;
    }
  });

  const sortedDates = Array.from(dateMap.keys()).sort();
  const data = sortedDates.map((date) => {
    const d = dateMap.get(date)!;
    const [y, m, day] = date.split("-");
    return {
      date: `${Number(m)}/${Number(day)}`,
      yamato: d.yamato,
      amazon: d.amazon,
      profit: d.profit,
    };
  });

  return NextResponse.json({ month, data });
}
