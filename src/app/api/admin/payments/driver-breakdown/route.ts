import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): { month: string; startDate: string; endDate: string } {
  let year: number;
  let month: number;
  const now = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    month: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shortCourseLabel(name: string): string {
  const t = String(name || "").trim();
  if (!t) return "未設定";
  const m = t.match(/\(([^)]+)\)/);
  if (m?.[1]) return m[1];
  return t;
}

function normalizeCarrierFromCourseName(courseName: string): "YAMATO" | "AMAZON" | "OTHER" {
  if (!courseName) return "OTHER";
  if (courseName.startsWith("ヤマト")) return "YAMATO";
  if (courseName.startsWith("Amazon") || courseName.startsWith("アマゾン")) return "AMAZON";
  return "OTHER";
}

type BreakdownLine = {
  title: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driver_id");
  if (!driverId) {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }
  const { month, startDate, endDate } = getMonthRange(req.nextUrl.searchParams.get("month"));

  const { data: courseRates, error: rateErr } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_driver_payout, nekopos_driver_payout, fixed_revenue, fixed_profit");
  if (rateErr) {
    console.error(rateErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  const rateByCourse = new Map<string, any>();
  (courseRates ?? []).forEach((r: any) => rateByCourse.set(String(r.course_id), r));

  const { data: courses, error: courseErr } = await supabase.from("courses").select("id, name, carrier");
  if (courseErr) {
    console.error(courseErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  const courseMap = new Map<string, any>();
  (courses ?? []).forEach((c: any) => courseMap.set(String(c.id), c));

  const { data: shifts, error: shiftErr } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .eq("driver_id", driverId)
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);
  if (shiftErr) {
    console.error(shiftErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const { data: reports, error: reportsErr } = await supabase
    .from("daily_reports")
    .select(
      "driver_id, report_date, carrier, takuhaibin_completed, nekopos_completed, approved_at, amazon_am_completed, amazon_pm_completed, amazon_4_completed",
    )
    .eq("driver_id", driverId)
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null);
  if (reportsErr) {
    console.error(reportsErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const reportMap = new Map<string, any>();
  (reports ?? []).forEach((r: any) => reportMap.set(`${r.driver_id}:${r.report_date}`, r));

  const lineMap = new Map<string, BreakdownLine>();
  const upsertLine = (title: string, qty: number, unitPrice: number) => {
    if (qty <= 0 || unitPrice <= 0) return;
    const key = `${title}__${unitPrice}`;
    const prev = lineMap.get(key);
    const nextQty = (prev?.qty ?? 0) + qty;
    lineMap.set(key, {
      title,
      qty: nextQty,
      unitPrice,
      amount: nextQty * unitPrice,
    });
  };

  (shifts ?? []).forEach((s: any) => {
    const date = String(s.shift_date ?? "");
    const courseId = String(s.course_id ?? "");
    if (!date || !courseId) return;
    const report = reportMap.get(`${driverId}:${date}`);
    if (!report) return;

    const rate = rateByCourse.get(courseId);
    if (!rate) return;
    const course = courseMap.get(courseId);
    const carrier: "YAMATO" | "AMAZON" | "OTHER" =
      (course?.carrier as "YAMATO" | "AMAZON" | "OTHER" | null) ??
      normalizeCarrierFromCourseName(String(course?.name ?? ""));
    const short = shortCourseLabel(String(course?.name ?? ""));

    if ((Number(rate.fixed_revenue) || 0) > 0) {
      const unit = Math.max(0, (Number(rate.fixed_revenue) || 0) - (Number(rate.fixed_profit) || 0));
      const title = `${carrier === "AMAZON" ? "Amazon" : "ヤマト"}（${short}）`;
      upsertLine(title, 1, unit);
      return;
    }

    const tkComp = Number(report.takuhaibin_completed) || 0;
    const nkComp = Number(report.nekopos_completed) || 0;
    const tkUnit = Number(rate.takuhaibin_driver_payout) || 0;
    const nkUnit = Number(rate.nekopos_driver_payout) || 0;
    upsertLine(`宅急便（${short}）`, tkComp, tkUnit);
    upsertLine(`ネコポス（${short}）`, nkComp, nkUnit);
  });

  const lines = Array.from(lineMap.values()).sort((a, b) => a.title.localeCompare(b.title, "ja"));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  return NextResponse.json({
    month,
    startDate,
    endDate,
    lines,
    total,
  });
}

