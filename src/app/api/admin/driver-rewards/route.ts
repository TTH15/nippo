import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type RewardLogDetail = {
  log_date: string;
  type_name: string;
  content: string;
  amount: number;
};

type FixedExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

type OptionalExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

function getMonthRange(monthParam?: string | null): {
  month: string;
  startDate: string;
  endDate: string;
} {
  let year: number;
  let month: number;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const startDate = `${year}-${mm}-01`;
  const endDate = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

  return {
    month: `${year}-${mm}`,
    startDate,
    endDate,
  };
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  const monthParam = url.searchParams.get("month");
  const driverId = url.searchParams.get("driver_id");

  if (!driverId) {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }

  const { month, startDate, endDate } = getMonthRange(monthParam);

  // シフト・日報から計算するドライバー売上（/api/me/rewards と同じロジック）
  const { data: courseRates } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_driver_payout, nekopos_driver_payout, fixed_revenue, fixed_profit");
  const rateByCourse: Record<
    string,
    { takuhaibin_driver_payout: number; nekopos_driver_payout: number; fixed_revenue: number; fixed_profit: number }
  > = {};
  (courseRates ?? []).forEach((r: any) => {
    rateByCourse[r.course_id] = {
      takuhaibin_driver_payout: Number(r.takuhaibin_driver_payout) || 0,
      nekopos_driver_payout: Number(r.nekopos_driver_payout) || 0,
      fixed_revenue: Number(r.fixed_revenue) || 0,
      fixed_profit: Number(r.fixed_profit) || 0,
    };
  });

  const { data: shifts } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .eq("driver_id", driverId)
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  const { data: reports } = await supabase
    .from("daily_reports")
    .select(
      "driver_id, report_date, carrier, takuhaibin_completed, nekopos_completed, amazon_am_completed, amazon_pm_completed, amazon_4_completed, approved_at",
    )
    .eq("driver_id", driverId)
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null);

  const reportMap = new Map<string, any>();
  (reports ?? []).forEach((r: any) => reportMap.set(`${r.driver_id}:${r.report_date}`, r));

  function reportContentString(rep: any): string {
    const carrier = rep?.carrier === "AMAZON" ? "AMAZON" : "YAMATO";
    if (carrier === "YAMATO") {
      const tk = Number(rep?.takuhaibin_completed) ?? 0;
      const nk = Number(rep?.nekopos_completed) ?? 0;
      return `宅急便 ${tk} 個 ネコポス ${nk} 個`;
    }
    const am = Number(rep?.amazon_am_completed) ?? 0;
    const pm = Number(rep?.amazon_pm_completed) ?? 0;
    const four = Number(rep?.amazon_4_completed) ?? 0;
    const parts: string[] = [];
    if (am > 0) parts.push(`午前 ${am} 個`);
    if (pm > 0) parts.push(`午後 ${pm} 個`);
    if (four > 0) parts.push(`4便 ${four} 個`);
    return parts.length > 0 ? parts.join(" ") : "—";
  }

  let calculatedIncome = 0;
  const dailyIncomeDetails: RewardLogDetail[] = [];

  (shifts ?? []).forEach((s: any) => {
    const date = s.shift_date;
    const courseId = s.course_id;
    const rate = rateByCourse[courseId];
    if (!rate) return;
    const rep = reportMap.get(`${driverId}:${date}`);
    if (!rep) return;

    let payout = 0;
    if (rate.fixed_revenue > 0) {
      const driverPayout = rate.fixed_revenue - rate.fixed_profit;
      if (driverPayout > 0) payout = driverPayout;
    } else {
      const tkComp = Number(rep.takuhaibin_completed) ?? 0;
      const nkComp = Number(rep.nekopos_completed) ?? 0;
      payout = tkComp * rate.takuhaibin_driver_payout + nkComp * rate.nekopos_driver_payout;
    }
    calculatedIncome += payout;
    dailyIncomeDetails.push({
      log_date: date,
      type_name: "日報",
      content: reportContentString(rep),
      amount: payout,
    });
  });

  dailyIncomeDetails.sort((a, b) => a.log_date.localeCompare(b.log_date));

  // 報酬調整（臨時経費）: amount は +控除 / -手当（報酬加算）
  const { data: adHocRows, error: adHocError } = await supabase
    .from("driver_ad_hoc_expenses")
    .select("month, name, amount, created_at, sales_log_entry_id, sales_log_entries(log_date)")
    .eq("driver_id", driverId)
    .eq("month", month)
    .order("created_at", { ascending: true });

  if (adHocError) {
    console.error("[/api/admin/driver-rewards] driver_ad_hoc_expenses error", adHocError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let rewardAdjustments = 0;
  let variableDeductions = 0;
  const logDetails: RewardLogDetail[] = (adHocRows ?? []).map((row: any) => {
    const rawAmount = Number(row.amount) || 0;
    const amount = -rawAmount;
    rewardAdjustments += amount;
    if (amount < 0) variableDeductions += Math.abs(amount);
    const salesLogDate = String(row?.sales_log_entries?.log_date ?? "").slice(0, 10);
    const fallbackMonthDate = `${String(row.month ?? month)}-01`;
    return {
      log_date: /^\d{4}-\d{2}-\d{2}$/.test(salesLogDate) ? salesLogDate : fallbackMonthDate,
      type_name: "報酬調整",
      content: String(row.name ?? ""),
      amount,
    };
  });

  // 固定経費
  const { data: fixedRows, error: fixedError } = await supabase
    .from("driver_fixed_expenses")
    .select(`
      id,
      name,
      amount,
      cycle,
      valid_from,
      valid_to
    `)
    .eq("driver_id", driverId)
    .eq("cycle", "MONTHLY")
    .lte("valid_from", endDate)
    .or(`valid_to.is.null,valid_to.gte.${startDate}`);

  if (fixedError) {
    console.error("[/api/admin/driver-rewards] driver_fixed_expenses error", fixedError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let fixedDeductions = 0;
  const fixedDetails: FixedExpenseDetail[] = (fixedRows ?? []).map((row: any) => {
    const amount = Number(row.amount) || 0;
    fixedDeductions += amount;
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      amount,
    };
  });

  // ドライバー入力の自由経費
  const { data: optionalRows, error: optionalError } = await supabase
    .from("driver_optional_expenses")
    .select("id, name, amount")
    .eq("driver_id", driverId)
    .eq("month", month);

  if (optionalError) {
    console.error("[/api/admin/driver-rewards] driver_optional_expenses error", optionalError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let optionalDeductions = 0;
  const optionalDetails: OptionalExpenseDetail[] = (optionalRows ?? []).map((row: any) => {
    const amount = Number(row.amount) || 0;
    optionalDeductions += amount;
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      amount,
    };
  });

  const totalIncome = calculatedIncome + rewardAdjustments;
  const net = totalIncome - fixedDeductions - optionalDeductions;

  return NextResponse.json({
    month,
    startDate,
    endDate,
    incomeLog: totalIncome,
    calculatedIncome,
    logIncome: rewardAdjustments,
    variableDeductions,
    fixedDeductions,
    optionalDeductions,
    net,
    logDetails,
    dailyIncomeDetails,
    fixedDetails,
    optionalDetails,
  });
}

