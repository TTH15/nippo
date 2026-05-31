import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { currentMonthJST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month") || currentMonthJST();
  const [year, mon] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const { data: drivers } = await supabase
    .from("drivers")
    .select("id, name")
    .eq("role", "DRIVER")
    .order("name");

  const { data: reports } = await supabase
    .from("daily_reports")
    .select("*")
    .gte("report_date", startDate)
    .lte("report_date", endDate);

  const { data: ratesData } = await supabase
    .from("rate_master")
    .select("kind, rate_per_completed");

  const rateMap: Record<string, number> = {};
  ratesData?.forEach((r) => (rateMap[r.kind] = r.rate_per_completed));
  const takuRate = rateMap["TAKUHAIBIN"] ?? 0;
  const nekoRate = rateMap["NEKOPOS"] ?? 0;

  const driverReports = new Map<string, typeof reports>();
  reports?.forEach((r) => {
    const arr = driverReports.get(r.driver_id) ?? [];
    arr.push(r);
    driverReports.set(r.driver_id, arr);
  });

  // Build CSV
  const header = "ドライバー名,稼働日数,宅急便完了,宅急便持戻,ネコポス完了,ネコポス持戻,支払試算額";
  const rows = (drivers ?? []).map((d) => {
    const reps = driverReports.get(d.id) ?? [];
    const tc = reps.reduce((s, r) => s + r.takuhaibin_completed, 0);
    const tr = reps.reduce((s, r) => s + r.takuhaibin_returned, 0);
    const nc = reps.reduce((s, r) => s + r.nekopos_completed, 0);
    const nr = reps.reduce((s, r) => s + r.nekopos_returned, 0);
    const pay = tc * takuRate + nc * nekoRate;
    return `${d.name},${reps.length},${tc},${tr},${nc},${nr},${pay}`;
  });

  const csv = "\uFEFF" + [header, ...rows].join("\n"); // BOM for Excel

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="monthly_${month}.csv"`,
    },
  });
}
