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

  const monthStart = reportDate.slice(0, 7) + "-01";
  const [y, m] = reportDate.slice(0, 7).split("-").map(Number);
  const nextMonthStr = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

  const { data: rows, error } = await supabase
    .from("daily_reports")
    .select(
      "carrier, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned, amazon_am_mochidashi, amazon_am_completed, amazon_pm_mochidashi, amazon_pm_completed, amazon_4_mochidashi, amazon_4_completed",
    )
    .eq("driver_identity_id", driverIdentityId)
    .gte("report_date", monthStart)
    .lt("report_date", nextMonthStr)
    .is("rejected_at", null);

  if (error) {
    return NextResponse.json({ error: "集計に失敗しました" }, { status: 500 });
  }

  const totals = {
    yamato: {
      takuhaibinCompleted: 0,
      takuhaibinReturned: 0,
      nekoposCompleted: 0,
      nekoposReturned: 0,
    },
    amazon: {
      amMochidashi: 0,
      amCompleted: 0,
      pmMochidashi: 0,
      pmCompleted: 0,
      fourMochidashi: 0,
      fourCompleted: 0,
    },
  };

  (rows ?? []).forEach((r: any) => {
    if (r.carrier === "AMAZON") {
      totals.amazon.amMochidashi += Number(r.amazon_am_mochidashi) || 0;
      totals.amazon.amCompleted += Number(r.amazon_am_completed) || 0;
      totals.amazon.pmMochidashi += Number(r.amazon_pm_mochidashi) || 0;
      totals.amazon.pmCompleted += Number(r.amazon_pm_completed) || 0;
      totals.amazon.fourMochidashi += Number(r.amazon_4_mochidashi) || 0;
      totals.amazon.fourCompleted += Number(r.amazon_4_completed) || 0;
    } else {
      totals.yamato.takuhaibinCompleted += Number(r.takuhaibin_completed) || 0;
      totals.yamato.takuhaibinReturned += Number(r.takuhaibin_returned) || 0;
      totals.yamato.nekoposCompleted += Number(r.nekopos_completed) || 0;
      totals.yamato.nekoposReturned += Number(r.nekopos_returned) || 0;
    }
  });

  return NextResponse.json({ month: reportDate.slice(0, 7), totals });
}
