import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
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

  // DRIVERロールのみ取得するようフィルタを追加
  const { data: drivers, error: dErr } = await supabase
    .from("drivers")
    .select("id, name, display_name")
    .eq("role", "DRIVER")
    .order("name");

  if (dErr) throw dErr;

  // Reports for this date（v2 ソース・互換リーダー）。endDate は排他のため当日のみ。
  const reports = await loadLegacyDailyRows(
    supabase,
    { start: startDate, end: startDate },
    { idSource: "v2", withVehicle: true },
  );
  const reportCountExact = reports.length;
  console.log("[admin/daily] debug", { projectRef, date, reportCountExact });

  const reportMap = new Map(reports.map((r) => [r.driver_id, r]));

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
