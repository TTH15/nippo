import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { computeDriverAutoPayout } from "@/server/billing/driverPayout";
import { loadDriverLease, loadCourseDailyLease, computeLeaseDeduction, leaseDailyRateForCourse } from "@/server/billing/driverLease";

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
  const orgId = await resolveOrgId(user.driverId);

  const monthParam = req.nextUrl.searchParams.get("month");
  const { month, startDate, endDate } = getMonthRange(monthParam);

  const driverId = user.driverId as string;

  // 自動算出の報酬は v2 集計モデル（admin/payments と一致）
  const autoPayout = await computeDriverAutoPayout(supabase, orgId, driverId, startDate, endDate);
  const calculatedIncome = autoPayout.total;

  // リース控除（driver_leases・専用概念）。DAILY はコース日額(courses.daily_lease)由来で日当へ反映。
  const [lease, courseDailyLease] = await Promise.all([
    loadDriverLease(supabase, driverId, startDate, endDate),
    loadCourseDailyLease(supabase),
  ]);
  const perDay = autoPayout.days.map((d) => ({ date: d.date, courseId: d.courseId }));
  const leaseDeductions = computeLeaseDeduction(lease, perDay, courseDailyLease);

  // DAILY のときはユニーク日付ごとに 1 回だけ「その日の最大コース日額」を控除（複数コース日も二重控除しない）
  const maxRateByDate = new Map<string, number>();
  for (const d of autoPayout.days) {
    const rate = leaseDailyRateForCourse(lease, d.courseId, courseDailyLease);
    maxRateByDate.set(d.date, Math.max(maxRateByDate.get(d.date) ?? 0, rate));
  }
  const seenLeaseDate = new Set<string>();
  const dailyIncomeDetails: RewardLogDetail[] = autoPayout.days.map((d) => {
    let amount = d.payout;
    let content = d.content;
    const rate = maxRateByDate.get(d.date) ?? 0;
    if (rate > 0 && !seenLeaseDate.has(d.date)) {
      seenLeaseDate.add(d.date);
      amount -= rate;
      content = `${d.content}（リース −${rate.toLocaleString("ja-JP")}円）`;
    }
    return {
      log_date: d.date,
      type_name: "日報",
      content,
      amount,
    };
  });

  // 報酬調整（臨時経費）: amount は +控除 / -手当（報酬加算）
  const { data: adHocRows, error: adHocError } = await supabase
    .from("driver_ad_hoc_expenses")
    .select("month, name, amount, created_at, sales_log_entry_id, sales_log_entries(log_date)")
    .eq("driver_id", user.driverId)
    .eq("month", month)
    .order("created_at", { ascending: true });

  if (adHocError) {
    console.error("[/api/me/rewards] driver_ad_hoc_expenses error", adHocError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let rewardAdjustments = 0;
  let variableDeductions = 0;
  const logDetails: RewardLogDetail[] = (adHocRows ?? []).map((row: any) => {
    const rawAmount = Number(row.amount) || 0;
    // driver_ad_hoc_expenses の符号を、ドライバー目線の表示符号に変換
    // (+) 報酬加算、(-) 報酬減算
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

  // 収入 = 日報・シフトから計算した報酬 + 報酬調整（手当/控除）
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
    leaseDetail: lease ? { mode: lease.mode, total: leaseDeductions } : null,
    net,
    logDetails,
    dailyIncomeDetails,
    fixedDetails,
    optionalDetails,
  });
}

