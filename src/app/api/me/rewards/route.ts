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

  // 売上ログ（ドライバー収入／変動控除）
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

  const net = incomeLog + variableDeductions - fixedDeductions;

  return NextResponse.json({
    month,
    startDate,
    endDate,
    incomeLog,
    variableDeductions,
    fixedDeductions,
    net,
    logDetails,
    fixedDetails,
  });
}

