import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): {
  month: string;
  startDate: string;
  endDate: string;
} {
  let year: number;
  let month: number;
  const now = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    month: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

type CourseRate = {
  course_id: string;
  takuhaibin_driver_payout: number;
  nekopos_driver_payout: number;
  fixed_revenue: number;
  fixed_profit: number;
};

export type DriverPaymentRow = {
  driverId: string;
  driverName: string;
  displayName: string | null;
  incomeLog: number;
  fixedDeductions: number;
  adHocDeductions: number;
  net: number;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const { month, startDate, endDate } = getMonthRange(monthParam);

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id, name, display_name")
    .eq("company_code", user.companyCode)
    .eq("role", "DRIVER")
    .order("name");

  if (driversError || !drivers?.length) {
    return NextResponse.json({
      month,
      startDate,
      endDate,
      rows: [] as DriverPaymentRow[],
    });
  }

  const driverIds = drivers.map((d: { id: string }) => d.id);

  // コース別単価（ドライバーへの支払額）
  const { data: courseRates } = await supabase
    .from("course_rates")
    .select(
      "course_id, takuhaibin_driver_payout, nekopos_driver_payout, fixed_revenue, fixed_profit",
    );
  const rateByCourse: Record<string, CourseRate> = {};
  (courseRates ?? []).forEach((r) => {
    rateByCourse[(r as any).course_id] = {
      course_id: (r as any).course_id,
      takuhaibin_driver_payout: Number((r as any).takuhaibin_driver_payout) || 0,
      nekopos_driver_payout: Number((r as any).nekopos_driver_payout) || 0,
      fixed_revenue: Number((r as any).fixed_revenue) || 0,
      fixed_profit: Number((r as any).fixed_profit) || 0,
    };
  });

  // 対象期間のシフト
  const { data: shifts } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  // 承認済み日報
  const { data: reports } = await supabase
    .from("daily_reports")
    .select(
      "driver_id, report_date, takuhaibin_completed, nekopos_completed, approved_at",
    )
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null);

  type ReportRow = NonNullable<typeof reports>[number];
  const reportMap = new Map<string, ReportRow>();
  (reports ?? []).forEach((r) =>
    reportMap.set(`${r.driver_id}:${r.report_date}`, r),
  );

  const incomeByDriver: Record<string, number> = {};
  driverIds.forEach((id: string) => {
    incomeByDriver[id] = 0;
  });

  (shifts ?? []).forEach((s: any) => {
    const driverId = s.driver_id as string | null;
    const date = s.shift_date as string;
    const courseId = s.course_id as string;
    if (!driverId || !driverIds.includes(driverId)) return;
    const rate = rateByCourse[courseId];
    if (!rate) return;
    const rep = reportMap.get(`${driverId}:${date}`);
    if (!rep) return;

    let payout = 0;
    if (rate.fixed_revenue > 0) {
      const driverPayout = rate.fixed_revenue - rate.fixed_profit;
      if (driverPayout > 0) payout = driverPayout;
    } else {
      const tkComp = (rep.takuhaibin_completed as number | null) ?? 0;
      const nkComp = (rep.nekopos_completed as number | null) ?? 0;
      payout =
        tkComp * rate.takuhaibin_driver_payout +
        nkComp * rate.nekopos_driver_payout;
    }

    if (payout > 0) {
      incomeByDriver[driverId] =
        (incomeByDriver[driverId] ?? 0) + payout;
    }
  });

  // 固定経費
  const { data: fixedRows } = await supabase
    .from("driver_fixed_expenses")
    .select("driver_id, amount")
    .in("driver_id", driverIds)
    .eq("cycle", "MONTHLY")
    .lte("valid_from", endDate)
    .or(`valid_to.is.null,valid_to.gte.${startDate}`);

  const fixedByDriver: Record<string, number> = {};
  driverIds.forEach((id: string) => {
    fixedByDriver[id] = 0;
  });
  (fixedRows ?? []).forEach((row: { driver_id: string; amount: number }) => {
    const id = row.driver_id;
    if (fixedByDriver[id] !== undefined) {
      fixedByDriver[id] += Number(row.amount) || 0;
    }
  });

  // 臨時経費
  const { data: adHocRows } = await supabase
    .from("driver_ad_hoc_expenses")
    .select("driver_id, amount")
    .in("driver_id", driverIds)
    .eq("month", month);

  const adHocByDriver: Record<string, number> = {};
  driverIds.forEach((id: string) => {
    adHocByDriver[id] = 0;
  });
  (adHocRows ?? []).forEach((row: { driver_id: string; amount: number }) => {
    const id = row.driver_id;
    if (adHocByDriver[id] !== undefined) {
      adHocByDriver[id] += Number(row.amount) || 0;
    }
  });

  const rows: DriverPaymentRow[] = drivers.map(
    (d: { id: string; name: string; display_name: string | null }) => {
      const incomeLog = incomeByDriver[d.id] ?? 0;
      const fixedDeductions = fixedByDriver[d.id] ?? 0;
      const adHocDeductions = adHocByDriver[d.id] ?? 0;
      const net = incomeLog - fixedDeductions - adHocDeductions;
      return {
        driverId: d.id,
        driverName: d.name,
        displayName: d.display_name ?? null,
        incomeLog,
        fixedDeductions,
        adHocDeductions,
        net,
      };
    },
  );

  return NextResponse.json({
    month,
    startDate,
    endDate,
    rows,
  });
}
