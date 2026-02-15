import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { currentMonthJST } from "@/lib/date";

export type MonthlyEntry = {
  driver: { id: string; name: string };
  totalTakuhaibinCompleted: number;
  totalTakuhaibinReturned: number;
  totalNekoposCompleted: number;
  totalNekoposReturned: number;
  workDays: number;
  estimatedPayment: number;
};

async function getRates() {
  const { data } = await supabase.from("rate_master").select("kind, rate_per_completed");
  const map: Record<string, number> = {};
  data?.forEach((r) => (map[r.kind] = r.rate_per_completed));
  return {
    takuhaibin: map["TAKUHAIBIN"] ?? 0,
    nekopos: map["NEKOPOS"] ?? 0,
  };
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month") || currentMonthJST();

  // Get all drivers
  const { data: drivers } = await supabase
    .from("drivers")
    .select("id, name")
    .eq("role", "DRIVER")
    .order("name");

  // Get reports for the month
  const [year, mon] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const { data: reports } = await supabase
    .from("daily_reports")
    .select("*")
    .gte("report_date", startDate)
    .lte("report_date", endDate);

  const rates = await getRates();

  // Aggregate per driver
  const driverReports = new Map<string, typeof reports>();
  reports?.forEach((r) => {
    const arr = driverReports.get(r.driver_id) ?? [];
    arr.push(r);
    driverReports.set(r.driver_id, arr);
  });

  const entries: MonthlyEntry[] = (drivers ?? []).map((d) => {
    const reps = driverReports.get(d.id) ?? [];
    const totals = reps.reduce(
      (acc, r) => ({
        tc: acc.tc + r.takuhaibin_completed,
        tr: acc.tr + r.takuhaibin_returned,
        nc: acc.nc + r.nekopos_completed,
        nr: acc.nr + r.nekopos_returned,
      }),
      { tc: 0, tr: 0, nc: 0, nr: 0 }
    );

    const payment =
      totals.tc * rates.takuhaibin + totals.nc * rates.nekopos;

    return {
      driver: { id: d.id, name: d.name },
      totalTakuhaibinCompleted: totals.tc,
      totalTakuhaibinReturned: totals.tr,
      totalNekoposCompleted: totals.nc,
      totalNekoposReturned: totals.nr,
      workDays: reps.length,
      estimatedPayment: payment,
    };
  });

  return NextResponse.json({ month, rates, entries });
}
