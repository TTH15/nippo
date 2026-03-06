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
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const { month, startDate, endDate } = getMonthRange(monthParam);

  const driverId = user.driverId as string;

  // 日報・シフトから計算するドライバー売上（payments API と同じロジック）
  const { data: courseRates } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_driver_payout, nekopos_driver_payout, fixed_revenue, fixed_profit");
  const rateByCourse: Record<string, { takuhaibin_driver_payout: number; nekopos_driver_payout: number; fixed_revenue: number; fixed_profit: number }> = {};
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
    .select("driver_id, report_date, takuhaibin_completed, nekopos_completed")
    .eq("driver_id", driverId)
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null);

  const reportMap = new Map<string, any>();
  (reports ?? []).forEach((r: any) => reportMap.set(`${r.driver_id}:${r.report_date}`, r));

  let calculatedIncome = 0;
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
  });

  // 売上ログ（ドライバー収入／変動控除）※ 計算売上とは別の手動登録分
  const { data: logRows, error: logError } = await supabase
    .from("sales_log_entries")
    .select(`
      log_date,
      amount,
      content,
      sales_log_types ( name )
    `)
    .eq("target_driver_id", user.driverId)
    .gte("log_date", startDate)
    .lte("log_date", endDate)
    .order("log_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (logError) {
    console.error("[/api/me/rewards] sales_log_entries error", logError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let incomeLog = 0;
  let variableDeductions = 0;

  const logDetails: RewardLogDetail[] = (logRows ?? []).map((row: any) => {
    const amount = Number(row.amount) || 0;
    if (amount > 0) {
      incomeLog += amount;
    } else if (amount < 0) {
      variableDeductions += amount;
    }
    const type = row.sales_log_types as { name: string } | null;
    return {
      log_date: String(row.log_date ?? ""),
      type_name: type?.name ?? "",
      content: String(row.content ?? ""),
      amount,
    };
  });

  // 固定経費（driver_fixed_expenses）
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
    .eq("driver_id", user.driverId)
    .eq("cycle", "MONTHLY")
    .lte("valid_from", endDate)
    .or(`valid_to.is.null,valid_to.gte.${startDate}`);

  if (fixedError) {
    console.error("[/api/me/rewards] driver_fixed_expenses error", fixedError);
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

  // ドライバー入力の自由経費（管理者は参照不可・報酬計算用のみ）
  const { data: optionalRows, error: optionalError } = await supabase
    .from("driver_optional_expenses")
    .select("id, name, amount")
    .eq("driver_id", user.driverId)
    .eq("month", month);

  if (optionalError) {
    console.error("[/api/me/rewards] driver_optional_expenses error", optionalError);
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

  // 収入 = 日報・シフトから計算した売上 + ログのプラス分（変動控除は net に含めない）
  const totalIncome = calculatedIncome + incomeLog;
  const net = totalIncome - fixedDeductions - optionalDeductions;

  return NextResponse.json({
    month,
    startDate,
    endDate,
    incomeLog: totalIncome,
    calculatedIncome,
    logIncome: incomeLog,
    variableDeductions,
    fixedDeductions,
    optionalDeductions,
    net,
    logDetails,
    fixedDetails,
    optionalDetails,
  });
}

