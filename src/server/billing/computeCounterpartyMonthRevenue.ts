import type { SupabaseClient } from "@supabase/supabase-js";

type CourseRate = {
  course_id: string;
  takuhaibin_revenue: number;
  takuhaibin_profit: number;
  nekopos_revenue: number;
  nekopos_profit: number;
  fixed_revenue: number;
  fixed_profit: number;
};

function normalizeCarrierFromCourseName(courseName: string) {
  if (!courseName) return "OTHER";
  if (courseName.startsWith("ヤマト")) return "YAMATO";
  if (courseName.startsWith("Amazon") || courseName.startsWith("アマゾン")) return "AMAZON";
  return "OTHER";
}

/**
 * 指定期間・取引先（請求先）に紐づくコースのシフト売上を、請求ドラフトと同じ単価ロジックで合算する。
 * ※「郵便局」帯の sales_log 集計はコース単位ではないため、ここには含めない。
 */
export async function computeCounterpartyMonthRevenue(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  counterpartyInvoiceAddressId: string
): Promise<number> {
  const { data: courses, error: coursesErr } = await supabase
    .from("courses")
    .select("id, name, carrier")
    .eq("counterparty_invoice_address_id", counterpartyInvoiceAddressId);
  if (coursesErr) throw coursesErr;
  if (!courses?.length) return 0;

  const allowedCourseIds = courses.map((c: { id: string }) => String(c.id));

  const { data: courseRates, error: rateErr } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_revenue, takuhaibin_profit, nekopos_revenue, nekopos_profit, fixed_revenue, fixed_profit");
  if (rateErr) throw rateErr;

  const rateByCourse: Record<string, CourseRate> = {};
  (courseRates ?? []).forEach((r: Record<string, unknown>) => {
    const id = String(r.course_id ?? "");
    if (!id) return;
    rateByCourse[id] = {
      course_id: id,
      takuhaibin_revenue: Number(r.takuhaibin_revenue) || 0,
      takuhaibin_profit: Number(r.takuhaibin_profit) || 0,
      nekopos_revenue: Number(r.nekopos_revenue) || 0,
      nekopos_profit: Number(r.nekopos_profit) || 0,
      fixed_revenue: Number(r.fixed_revenue) || 0,
      fixed_profit: Number(r.fixed_profit) || 0,
    };
  });

  const { data: shifts, error: shiftsErr } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate)
    .in("course_id", allowedCourseIds);
  if (shiftsErr) throw shiftsErr;

  const { data: reports, error: reportsErr } = await supabase
    .from("daily_reports")
    .select("driver_id, report_date, takuhaibin_completed, nekopos_completed")
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null);
  if (reportsErr) throw reportsErr;

  const reportMap = new Map<string, Record<string, unknown>>();
  (reports ?? []).forEach((r: Record<string, unknown>) => {
    reportMap.set(`${r.driver_id}:${r.report_date}`, r);
  });

  let total = 0;

  (shifts ?? []).forEach((s: Record<string, unknown>) => {
    const driverId = s.driver_id as string | undefined;
    const courseId = s.course_id as string | undefined;
    const date = s.shift_date as string | undefined;
    if (!driverId || !courseId || !date) return;

    const rep = reportMap.get(`${driverId}:${date}`);
    if (!rep) return;

    const rate = rateByCourse[courseId];
    if (!rate) return;

    if (rate.fixed_revenue > 0) {
      total += rate.fixed_revenue;
      return;
    }

    const tkComp = Number(rep.takuhaibin_completed ?? 0) || 0;
    const nkComp = Number(rep.nekopos_completed ?? 0) || 0;
    total += tkComp * rate.takuhaibin_revenue + nkComp * rate.nekopos_revenue;
  });

  return total;
}

export type CounterpartyCourse = { id: string; name: string; carrier: "YAMATO" | "AMAZON" | "OTHER" };

export function dominantSectionFromCourses(courses: CounterpartyCourse[]): "Amazon" | "ヤマト運輸" | "郵便局" {
  let a = 0;
  let y = 0;
  let o = 0;
  for (const c of courses) {
    if (c.carrier === "AMAZON") a++;
    else if (c.carrier === "YAMATO") y++;
    else o++;
  }
  if (a >= y && a >= o) return "Amazon";
  if (y >= o) return "ヤマト運輸";
  return "郵便局";
}
