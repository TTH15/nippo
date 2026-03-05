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

export type DriverPaymentRow = {
  driverId: string;
  driverName: string;
  displayName: string | null;
  incomeLog: number;
  variableDeductions: number;
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

  const { data: logRows } = await supabase
    .from("sales_log_entries")
    .select("target_driver_id, amount, attribution")
    .in("target_driver_id", driverIds)
    .eq("attribution", "DRIVER")
    .gte("log_date", startDate)
    .lte("log_date", endDate);

  const incomeByDriver: Record<string, number> = {};
  const variableByDriver: Record<string, number> = {};
  driverIds.forEach((id: string) => {
    incomeByDriver[id] = 0;
    variableByDriver[id] = 0;
  });
  (logRows ?? []).forEach((row: { target_driver_id: string | null; amount: number }) => {
    const id = row.target_driver_id;
    if (!id || !driverIds.includes(id)) return;
    const amount = Number(row.amount) || 0;
    if (amount > 0) incomeByDriver[id] = (incomeByDriver[id] ?? 0) + amount;
    else if (amount < 0) variableByDriver[id] = (variableByDriver[id] ?? 0) + amount;
  });

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

  const rows: DriverPaymentRow[] = drivers.map((d: { id: string; name: string; display_name: string | null }) => {
    const incomeLog = incomeByDriver[d.id] ?? 0;
    const variableDeductions = variableByDriver[d.id] ?? 0;
    const fixedDeductions = fixedByDriver[d.id] ?? 0;
    const adHocDeductions = adHocByDriver[d.id] ?? 0;
    const net = incomeLog + variableDeductions - fixedDeductions - adHocDeductions;
    return {
      driverId: d.id,
      driverName: d.name,
      displayName: d.display_name ?? null,
      incomeLog,
      variableDeductions,
      fixedDeductions,
      adHocDeductions,
      net,
    };
  });

  return NextResponse.json({
    month,
    startDate,
    endDate,
    rows,
  });
}
