import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const reportDate = req.nextUrl.searchParams.get("reportDate");
  const driverIdentityId = req.nextUrl.searchParams.get("driverIdentityId");
  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return NextResponse.json({ error: "reportDate (YYYY-MM-DD) が必要です" }, { status: 400 });
  }
  if (!driverIdentityId || typeof driverIdentityId !== "string") {
    return NextResponse.json({ error: "driverIdentityId が必要です" }, { status: 400 });
  }

  const { data: identity, error: idErr } = await supabase
    .from("driver_identities")
    .select("id, driver_id")
    .eq("id", driverIdentityId)
    .eq("driver_id", user.driverId)
    .single();
  if (idErr || !identity) {
    return NextResponse.json({ error: "勤務区分が見つかりません" }, { status: 404 });
  }

  const { data: report } = await supabase
    .from("daily_reports")
    .select("takuhaibin_completed, nekopos_completed, carrier, approved_at, rejected_at")
    .eq("driver_identity_id", driverIdentityId)
    .eq("report_date", reportDate)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ reward: 0, hasShift: false });
  }

  const { data: shifts } = await supabase
    .from("shifts")
    .select("course_id")
    .eq("shift_date", reportDate)
    .eq("driver_id", user.driverId);
  const courseIds = Array.from(new Set((shifts ?? []).map((s: any) => s.course_id).filter(Boolean)));
  if (courseIds.length === 0) {
    return NextResponse.json({ reward: 0, hasShift: false });
  }

  const { data: rates } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_driver_payout, nekopos_driver_payout, fixed_revenue, fixed_profit")
    .in("course_id", courseIds);

  const tkComp = Number((report as any).takuhaibin_completed) || 0;
  const nkComp = Number((report as any).nekopos_completed) || 0;

  let reward = 0;
  (shifts ?? []).forEach((s: any) => {
    const rate = (rates ?? []).find((r: any) => r.course_id === s.course_id);
    if (!rate) return;
    if ((Number(rate.fixed_revenue) || 0) > 0) {
      const v = (Number(rate.fixed_revenue) || 0) - (Number(rate.fixed_profit) || 0);
      if (v > 0) reward += v;
    } else {
      reward += tkComp * (Number(rate.takuhaibin_driver_payout) || 0);
      reward += nkComp * (Number(rate.nekopos_driver_payout) || 0);
    }
  });

  return NextResponse.json({ reward: Math.max(0, reward), hasShift: true });
}

