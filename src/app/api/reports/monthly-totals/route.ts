import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type DriverAgg = {
  tk: number;
  nk: number;
  am: number;
  pm: number;
  four: number;
};

function rankFor(
  myDriverId: string,
  perDriver: Map<string, DriverAgg>,
  getter: (e: DriverAgg) => number,
): { rank: number; total: number } | null {
  const myVal = getter(perDriver.get(myDriverId) ?? { tk: 0, nk: 0, am: 0, pm: 0, four: 0 });
  if (myVal <= 0) return null;
  let total = 0;
  let greater = 0;
  perDriver.forEach((e) => {
    const v = getter(e);
    if (v <= 0) return;
    total += 1;
    if (v > myVal) greater += 1;
  });
  return { rank: greater + 1, total };
}

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

  // 当該勤務区分の月間合計
  const { data: myRows, error: myErr } = await supabase
    .from("daily_reports")
    .select(
      "carrier, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned, amazon_am_mochidashi, amazon_am_completed, amazon_pm_mochidashi, amazon_pm_completed, amazon_4_mochidashi, amazon_4_completed",
    )
    .eq("driver_identity_id", driverIdentityId)
    .gte("report_date", monthStart)
    .lt("report_date", nextMonthStr)
    .is("rejected_at", null);

  if (myErr) {
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

  (myRows ?? []).forEach((r: any) => {
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

  // 全勤務区分単位で集計 — ランキング算出用（表示値と整合させるため driver_identity_id 単位）
  const { data: allRows, error: allErr } = await supabase
    .from("daily_reports")
    .select(
      "driver_identity_id, carrier, takuhaibin_completed, nekopos_completed, amazon_am_completed, amazon_pm_completed, amazon_4_completed",
    )
    .gte("report_date", monthStart)
    .lt("report_date", nextMonthStr)
    .is("rejected_at", null);

  if (allErr) {
    return NextResponse.json({ error: "順位集計に失敗しました" }, { status: 500 });
  }

  const perDriver = new Map<string, DriverAgg>();
  (allRows ?? []).forEach((r: any) => {
    const id = r.driver_identity_id;
    if (!id) return;
    const entry = perDriver.get(id) ?? { tk: 0, nk: 0, am: 0, pm: 0, four: 0 };
    if (r.carrier === "AMAZON") {
      entry.am += Number(r.amazon_am_completed) || 0;
      entry.pm += Number(r.amazon_pm_completed) || 0;
      entry.four += Number(r.amazon_4_completed) || 0;
    } else {
      entry.tk += Number(r.takuhaibin_completed) || 0;
      entry.nk += Number(r.nekopos_completed) || 0;
    }
    perDriver.set(id, entry);
  });

  const ranks = {
    takuhaibinCompleted: rankFor(driverIdentityId, perDriver, (e) => e.tk),
    nekoposCompleted: rankFor(driverIdentityId, perDriver, (e) => e.nk),
    amazonAmCompleted: rankFor(driverIdentityId, perDriver, (e) => e.am),
    amazonPmCompleted: rankFor(driverIdentityId, perDriver, (e) => e.pm),
    amazon4Completed: rankFor(driverIdentityId, perDriver, (e) => e.four),
  };

  return NextResponse.json({ month: reportDate.slice(0, 7), totals, ranks });
}
