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

const zeroRate = (): CourseRate => ({
  course_id: "",
  takuhaibin_revenue: 0,
  takuhaibin_profit: 0,
  nekopos_revenue: 0,
  nekopos_profit: 0,
  fixed_revenue: 0,
  fixed_profit: 0,
});

function normalizeCarrierFromCourseName(courseName: string) {
  if (!courseName) return "OTHER";
  if (courseName.startsWith("ヤマト")) return "YAMATO";
  if (courseName.startsWith("Amazon") || courseName.startsWith("アマゾン")) return "AMAZON";
  return "OTHER";
}

export type SystemBillingLineKind = "course_fixed" | "course_takuhaibin" | "course_nekopos";

/** システム集計行（コース別・請求書明細風） */
export type SystemBillingLine = {
  kind: SystemBillingLineKind;
  /** 明細キー: fx:/tk:/nk: + courseId（統合・摘要オーバーライド用） */
  lineKey: string;
  courseId: string;
  courseName: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type CourseAgg = {
  name: string;
  fixedDays: number;
  rate: CourseRate;
};

/**
 * 取引先に紐づくコースごとの件数・売上行を、請求ドラフトと同じ単価ロジックで算出する。
 */
export async function computeCounterpartyMonthBillingDetail(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  counterpartyInvoiceAddressId: string
): Promise<{ systemLines: SystemBillingLine[]; systemTotal: number }> {
  const { data: courses, error: coursesErr } = await supabase
    .from("courses")
    .select("id, name, carrier")
    .eq("counterparty_invoice_address_id", counterpartyInvoiceAddressId)
    .order("sort_order", { ascending: true });
  if (coursesErr) throw coursesErr;
  if (!courses?.length) return { systemLines: [], systemTotal: 0 };

  const coursesOrdered = courses as { id: string; name?: string | null }[];
  const allowedCourseIds = coursesOrdered.map((c) => String(c.id));

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

  const perCourse = new Map<string, CourseAgg>();
  const perCourseDriver = new Map<string, { takuhaibinCount: number; nekoposCount: number }>();
  for (const c of coursesOrdered) {
    const id = String(c.id);
    perCourse.set(id, {
      name: String(c.name ?? ""),
      fixedDays: 0,
      rate: rateByCourse[id] ?? zeroRate(),
    });
  }

  const { data: drivers, error: driversErr } = await supabase
    .from("drivers")
    .select("id, name, display_name");
  if (driversErr) throw driversErr;
  const driverNameMap = new Map<string, string>();
  (drivers ?? []).forEach((d: Record<string, unknown>) => {
    const id = String(d.id ?? "");
    if (!id) return;
    const displayName = String(d.display_name ?? "").trim();
    const fullName = String(d.name ?? "").trim();
    driverNameMap.set(id, displayName || fullName || "担当者");
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

  (shifts ?? []).forEach((s: Record<string, unknown>) => {
    const driverId = s.driver_id as string | undefined;
    const courseId = s.course_id as string | undefined;
    const date = s.shift_date as string | undefined;
    if (!driverId || !courseId || !date) return;

    const rep = reportMap.get(`${driverId}:${date}`);
    if (!rep) return;

    const courseAgg = perCourse.get(courseId);
    if (!courseAgg) return;

    const rate = courseAgg.rate;
    if (rate.fixed_revenue > 0) {
      courseAgg.fixedDays += 1;
      return;
    }

    const tkComp = Number(rep.takuhaibin_completed ?? 0) || 0;
    const nkComp = Number(rep.nekopos_completed ?? 0) || 0;
    const key = `${courseId}:${driverId}`;
    const prev = perCourseDriver.get(key) ?? { takuhaibinCount: 0, nekoposCount: 0 };
    prev.takuhaibinCount += tkComp;
    prev.nekoposCount += nkComp;
    perCourseDriver.set(key, prev);
  });

  const systemLines: SystemBillingLine[] = [];
  let systemTotal = 0;

  for (const c of coursesOrdered) {
    const courseId = String(c.id);
    const agg = perCourse.get(courseId);
    if (!agg) continue;
    const { rate, name } = agg;
    if (rate.fixed_revenue > 0) {
      const amount = agg.fixedDays * rate.fixed_revenue;
      systemTotal += amount;
      systemLines.push({
        kind: "course_fixed",
        lineKey: `fx:${courseId}`,
        courseId,
        courseName: name,
        label: `${name}（固定売上・稼働日）`,
        quantity: agg.fixedDays,
        unitPrice: rate.fixed_revenue,
        amount,
      });
    } else {
      const driverRows = Array.from(perCourseDriver.entries())
        .filter(([k]) => k.startsWith(`${courseId}:`))
        .map(([k, v]) => {
          const driverId = k.split(":")[1] || "";
          return { driverId, ...v };
        })
        .sort((a, b) => {
          const an = driverNameMap.get(a.driverId) ?? "";
          const bn = driverNameMap.get(b.driverId) ?? "";
          return an.localeCompare(bn, "ja");
        });

      for (const row of driverRows) {
        const driverName = driverNameMap.get(row.driverId) ?? "担当者";
        const tkAmt = row.takuhaibinCount * rate.takuhaibin_revenue;
        const nkAmt = row.nekoposCount * rate.nekopos_revenue;
        systemTotal += tkAmt + nkAmt;
        systemLines.push({
          kind: "course_takuhaibin",
          lineKey: `tk:${courseId}:drv:${row.driverId}`,
          courseId,
          courseName: name,
          label: `${name} 宅急便（${driverName}）`,
          quantity: row.takuhaibinCount,
          unitPrice: rate.takuhaibin_revenue,
          amount: tkAmt,
        });
        systemLines.push({
          kind: "course_nekopos",
          lineKey: `nk:${courseId}:drv:${row.driverId}`,
          courseId,
          courseName: name,
          label: `${name} ネコポス（${driverName}）`,
          quantity: row.nekoposCount,
          unitPrice: rate.nekopos_revenue,
          amount: nkAmt,
        });
      }
    }
  }

  return { systemLines, systemTotal };
}

/**
 * 指定期間・取引先（請求先）に紐づくコースのシフト売上合計（システム計上のみ）。
 */
export async function computeCounterpartyMonthRevenue(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  counterpartyInvoiceAddressId: string
): Promise<number> {
  const { systemTotal } = await computeCounterpartyMonthBillingDetail(
    supabase,
    startDate,
    endDate,
    counterpartyInvoiceAddressId
  );
  return systemTotal;
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
