import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

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

  // 名簿・シフトと並び順を揃える（list_no 昇順）。status は下の絞り込みに使う。
  const { data: drivers, error: dErr } = await supabase
    .from("drivers")
    .select("id, name, display_name, status, list_no")
    .eq("org_id", orgId)
    .eq("works_as_driver", true)
    .order("list_no", { ascending: true, nullsFirst: false })
    .order("name");

  if (dErr) throw dErr;

  // Reports for this date（v2 ソース・互換リーダー）。endDate は排他のため当日のみ。
  const reports = await loadLegacyDailyRows(
    supabase,
    orgId,
    { start: startDate, end: startDate },
    { idSource: "v2", withVehicle: true },
  );
  const reportCountExact = reports.length;
  console.log("[admin/daily] debug", { projectRef, date, reportCountExact });

  const reportMap = new Map(reports.map((r) => [r.driver_id, r]));

  const result = (drivers ?? [])
    // 稼働終了（active 以外）で、その日の実績も無い人は出さない。
    // 退職者でも在籍中に出した日報は残る（＝過去の記録・承認漏れを見失わない）。
    .filter((d) => d.status === "active" || reportMap.has(d.id))
    .map((d) => ({
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
