import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { buildContext, buildContributions } from "@/server/aggregation/compute";

export const dynamic = "force-dynamic";

// ============================================================
// 売上アナリティクス（日別）。新モデル（daily_reports_v2 + report_entries +
// course_unit_rates + course_fixed_rates + ledger_entries）を集計エンジンで読む。
// レスポンス形・バケット仕様は旧実装と同一に保つ:
//   yamato = 自動算出(YAMATO+その他キャリア), amazon = 自動算出(AMAZON),
//   other  = 台帳(ledger)の売上, profit = 全利益(自動+台帳),
//   yamato_profit/amazon_profit = 自動算出のキャリア別利益。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const courseIdsParam = url.searchParams.get("course_ids");
  const driverIdParam = url.searchParams.get("driver_id");
  const courseIds = new Set(
    courseIdsParam && courseIdsParam.trim()
      ? courseIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : [],
  );
  const driverId = driverIdParam?.trim() || "";

  let startDate: string;
  let endDate: string;
  if (startParam && endParam) {
    startDate = startParam;
    endDate = endParam;
  } else {
    const month = url.searchParams.get("month") || "";
    const [year, mon] = month
      ? month.split("-").map(Number)
      : [new Date().getFullYear(), new Date().getMonth() + 1];
    startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  // 自動算出は新モデル(v2)、手動調整(売上ログ)は既存 sales_log_entries を直接読む（ハイブリッド）
  const data = await loadAggregationData(supabase, startDate, endDate);
  const codeByCarrier = new Map(data.carriers.map((c) => [c.id, c.code]));
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates);
  const contribs = buildContributions(data.reports, [], ctx); // ledgerは使わず手動分は下で別途

  type Bucket = { yamato: number; amazon: number; other: number; yamato_profit: number; amazon_profit: number; profit: number };
  const dateMap = new Map<string, Bucket>();
  const ensure = (d: string) => {
    if (!dateMap.has(d)) dateMap.set(d, { yamato: 0, amazon: 0, other: 0, yamato_profit: 0, amazon_profit: 0, profit: 0 });
    return dateMap.get(d)!;
  };

  // 自動算出（reports × rates）
  for (const c of contribs) {
    if (c.date < startDate || c.date > endDate) continue;
    if (courseIds.size > 0 && (!c.courseId || !courseIds.has(c.courseId))) continue;
    if (driverId && c.driverId !== driverId) continue;
    const e = ensure(c.date);
    const code = codeByCarrier.get(c.carrierId ?? "");
    if (code === "AMAZON") {
      e.amazon += c.revenue;
      e.amazon_profit += c.profit;
    } else {
      e.yamato += c.revenue;
      e.yamato_profit += c.profit;
    }
    e.profit += c.profit;
  }

  // 手動調整（売上ログ）: revenue→other, profit→profit（旧仕様踏襲）
  const logQuery = supabase
    .from("sales_log_entries")
    .select("log_date, revenue, profit, target_driver_id")
    .gte("log_date", startDate)
    .lte("log_date", endDate);
  const { data: logRows } = driverId ? await logQuery.eq("target_driver_id", driverId) : await logQuery;
  (logRows ?? []).forEach((row: any) => {
    const date = row.log_date as string;
    if (!date || date < startDate || date > endDate) return;
    const e = ensure(date);
    const revenue = Number(row.revenue) || 0;
    if (revenue > 0) e.other += revenue;
    e.profit += Number(row.profit) || 0;
  });

  // 範囲内の空き日を 0 で埋める
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
    const d = new Date(start);
    while (d <= end) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      ensure(iso);
      d.setDate(d.getDate() + 1);
    }
  }

  const sortedDates = Array.from(dateMap.keys()).sort();
  const out = sortedDates.map((date) => {
    const d = dateMap.get(date)!;
    const [, m, day] = date.split("-");
    return {
      iso: date,
      date: `${Number(m)}/${Number(day)}`,
      yamato: d.yamato,
      amazon: d.amazon,
      other: d.other,
      yamato_profit: d.yamato_profit,
      amazon_profit: d.amazon_profit,
      profit: d.profit,
    };
  });

  const response = NextResponse.json({ startDate, endDate, data: out });
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=600");
  return response;
}
