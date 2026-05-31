import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { computeDriverAutoPayout } from "@/server/billing/driverPayout";
import { loadDriverLease, leaseDailyRate, leaseDeductionForRange } from "@/server/billing/driverLease";

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

  // 自動算出の報酬は v2 集計モデル（/api/me/rewards・admin/payments と一致）
  const autoPayout = await computeDriverAutoPayout(supabase, driverId, startDate, endDate);
  const calculatedIncome = autoPayout.total;

  // リース控除（driver_leases）。DAILY は日当（日次明細）へ反映。
  const lease = await loadDriverLease(supabase, driverId, startDate, endDate);
  const dailyRate = leaseDailyRate(lease);
  const workedDays = new Set(autoPayout.days.map((d) => d.date)).size;
  const leaseDeductions = leaseDeductionForRange(lease, workedDays);

  const seenLeaseDate = new Set<string>();
  const dailyIncomeDetails: RewardLogDetail[] = autoPayout.days.map((d) => {
    let amount = d.payout;
    let content = d.content;
    if (dailyRate > 0 && !seenLeaseDate.has(d.date)) {
      seenLeaseDate.add(d.date);
      amount -= dailyRate;
      content = `${d.content}（リース −${dailyRate.toLocaleString("ja-JP")}円）`;
    }
    return { log_date: d.date, type_name: "日報", content, amount };
  });

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
  const net = totalIncome - fixedDeductions - optionalDeductions - leaseDeductions;

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
    leaseDeductions,
    leaseDetail: lease ? { mode: lease.mode, amount: lease.amount, total: leaseDeductions, days: workedDays } : null,
    net,
    logDetails,
    dailyIncomeDetails,
    fixedDetails,
    optionalDetails,
  });
}

