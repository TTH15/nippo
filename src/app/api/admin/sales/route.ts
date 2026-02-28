import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type CourseRate = {
  course_id: string;
  takuhaibin_revenue: number;
  takuhaibin_profit: number;
  nekopos_revenue: number;
  nekopos_profit: number;
  fixed_revenue: number;
  fixed_profit: number;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  // DB から取得する生データの範囲（シード期間に合わせて十分広く取る）
  const RAW_START = "2025-01-01";
  const RAW_END = "2026-12-31";

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const courseIdsParam = url.searchParams.get("course_ids");
  const courseIds: string[] =
    courseIdsParam && courseIdsParam.trim()
      ? courseIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : [];

  let startDate: string;
  let endDate: string;

  if (startParam && endParam) {
    startDate = startParam;
    endDate = endParam;
  } else {
    // 後方互換: start/end がない場合は従来どおり month から月初〜月末を計算
    const month = url.searchParams.get("month") || "";
    const [year, mon] = month
      ? month.split("-").map(Number)
      : [new Date().getFullYear(), new Date().getMonth() + 1];
    startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  const { data: courseRates } = await supabase
    .from("course_rates")
    .select(
      "course_id, takuhaibin_revenue, takuhaibin_profit, nekopos_revenue, nekopos_profit, fixed_revenue, fixed_profit",
    );

  const { data: courses } = await supabase.from("courses").select("id, name");
  const courseNameMap = Object.fromEntries((courses ?? []).map((c) => [c.id, c.name]));
  const rateByCourse = Object.fromEntries(
    (courseRates ?? []).map((r) => [r.course_id, r as CourseRate]),
  );

  const { data: shifts } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .gte("shift_date", RAW_START)
    .lte("shift_date", RAW_END);

  // 売上集計には承認済みの日報のみを含める
  const { data: reports } = await supabase
    .from("daily_reports")
    .select(
      "driver_id, report_date, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned",
    )
    .gte("report_date", RAW_START)
    .lte("report_date", RAW_END)
    .not("approved_at", "is", null);

  type ReportRow = NonNullable<typeof reports>[number];
  const reportMap = new Map<string, ReportRow>();
  reports?.forEach((r) => reportMap.set(`${r.driver_id}:${r.report_date}`, r));

  const dateMap = new Map<string, { yamato: number; amazon: number; profit: number }>();

  shifts?.forEach((s) => {
    const date = s.shift_date;
    // コースで絞り込み（指定がある場合のみ）
    if (courseIds.length > 0 && !courseIds.includes(s.course_id)) return;
    // ユーザーが指定した範囲外の日付は集計対象にしない
    if (date < startDate || date > endDate) return;
    if (!dateMap.has(date)) dateMap.set(date, { yamato: 0, amazon: 0, profit: 0 });
    const entry = dateMap.get(date)!;
    const rate = rateByCourse[s.course_id];
    const courseName = courseNameMap[s.course_id] ?? "";

    if (courseName === "Amazonミッドナイト" && rate) {
      const rep = reportMap.get(`${s.driver_id}:${date}`);
      if (rep) {
        entry.amazon += rate.fixed_revenue;
        entry.profit += rate.fixed_profit;
      }
    } else if (rate && (rate.takuhaibin_revenue > 0 || rate.nekopos_revenue > 0)) {
      const rep = reportMap.get(`${s.driver_id}:${date}`);
      const tkComp = rep?.takuhaibin_completed ?? 0;
      const nkComp = rep?.nekopos_completed ?? 0;
      entry.yamato += tkComp * rate.takuhaibin_revenue + nkComp * rate.nekopos_revenue;
      entry.profit += tkComp * rate.takuhaibin_profit + nkComp * rate.nekopos_profit;
    }
  });

  // 選択期間内でデータが存在しない日も 0 として埋める
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
    const d = new Date(start);
    while (d <= end) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const iso = `${y}-${m}-${day}`;
      if (!dateMap.has(iso)) {
        dateMap.set(iso, { yamato: 0, amazon: 0, profit: 0 });
      }
      d.setDate(d.getDate() + 1);
    }
  }

  const sortedDates = Array.from(dateMap.keys()).sort();
  const data = sortedDates.map((date) => {
    const d = dateMap.get(date)!;
    const [, m, day] = date.split("-");
    return {
      date: `${Number(m)}/${Number(day)}`,
      yamato: d.yamato,
      amazon: d.amazon,
      profit: d.profit,
    };
  });

  return NextResponse.json({ startDate, endDate, data });
}
