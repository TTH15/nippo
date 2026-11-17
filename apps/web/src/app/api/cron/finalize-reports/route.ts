import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { fetchAllRows } from "@/server/aggregation/pagination";
import { finalizeReportDay } from "@/server/reports/finalization";
import { reportDateDefaultJST } from "@/lib/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  try {
    // 承認が遅れた過去分・前回失敗分も対象。3時前は前々日まで。
    const reports = await fetchAllRows<{ org_id: string; driver_id: string; report_date: string }>((from, to) => supabase
      // tenant-scope-ok: Cron専用の会社横断処理。保存RPCで各会社・本人・日付を再照合する
      .from("daily_reports_v2").select("org_id,driver_id,report_date").not("approved_at", "is", null)
      .is("rejected_at", null).is("finalized_at", null).eq("finalization_required", true).lt("report_date", reportDateDefaultJST()).order("id").range(from, to));
    const days = [...new Map(reports.map(r => [`${r.org_id}:${r.driver_id}:${r.report_date}`, r])).values()];
    let finalized = 0;
    const failures: { date: string; code: string }[] = [];
    let processed = 0;
    for (const day of days) {
      // DBの15秒上限を持つ処理が残っても、関数の実行上限までに応答する。
      if (Date.now() - startedAt > 25_000) break;
      try { finalized += await finalizeReportDay(day.org_id, day.driver_id, day.report_date); }
      catch (error) { failures.push({ date: day.report_date, code: error && typeof error === "object" && "code" in error ? String(error.code) : "unknown" }); }
      processed++;
    }
    return NextResponse.json({ finalized, failures, remaining: days.length - processed }, { status: failures.length ? 500 : 200 });
  } catch {
    return NextResponse.json({ error: "日報の確定に失敗しました" }, { status: 500 });
  }
}
