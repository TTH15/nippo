import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const date = req.nextUrl.searchParams.get("date") || todayJST();

  // 日付範囲（[date, date+1)）を計算して、等価比較ではなく範囲指定で絞り込む
  const startDate = date;
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  const endDate = d.toISOString().slice(0, 10); // YYYY-MM-DD

   // 接続先Supabaseプロジェクト（project ref）をログに出す（キーやフルURLは出さない）
  let projectRef = "unknown";
  try {
    if (process.env.SUPABASE_URL) {
      const host = new URL(process.env.SUPABASE_URL).hostname;
      projectRef = host.split(".")[0] ?? host;
    }
  } catch {
    projectRef = "parse_error";
  }

  // この日付のレコード件数だけを取得してログ出力
  const { count: reportCountExact, error: countErr } = await supabase
    .from("daily_reports")
    .select("*", { count: "exact", head: true })
    .gte("report_date", startDate)
    .lt("report_date", endDate);

  if (countErr) {
    console.error("[admin/daily] count error", { projectRef, date, error: countErr });
  } else {
    console.log("[admin/daily] debug", { projectRef, date, reportCountExact });
  }

  // 全ドライバー（role フィルタは一旦外す：ロール値の揺れに影響されないようにする）
  const { data: drivers, error: dErr } = await supabase
    .from("drivers")
    .select("id, name, display_name")
    .order("name");

  if (dErr) throw dErr;

  // Reports for this date
  const { data: reports, error: rErr } = await supabase
    .from("daily_reports")
    .select("*")
    .gte("report_date", startDate)
    .lt("report_date", endDate);

  if (rErr) throw rErr;

  const reportMap = new Map(reports?.map((r) => [r.driver_id, r]));

  const result = (drivers ?? []).map((d) => ({
    driver: { id: d.id, name: d.name, display_name: d.display_name ?? null },
    report: reportMap.get(d.id) ?? null,
  }));

  return NextResponse.json({
    date,
    entries: result,
    driverCount: drivers?.length ?? 0,
    reportCount: reports?.length ?? 0,
    reportCountExact: reportCountExact ?? null,
    projectRef,
  });
}
