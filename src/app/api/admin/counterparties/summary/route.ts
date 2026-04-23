import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import {
  dominantSectionFromCourses,
  type CounterpartyCourse,
} from "@/server/billing/computeCounterpartyMonthRevenue";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): { month: string; startDate: string; endDate: string } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
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

function normalizeCarrierFromCourseName(courseName: string): "YAMATO" | "AMAZON" | "OTHER" {
  if (!courseName) return "OTHER";
  if (courseName.startsWith("ヤマト")) return "YAMATO";
  if (courseName.startsWith("Amazon") || courseName.startsWith("アマゾン")) return "AMAZON";
  return "OTHER";
}

function toCounterpartyCourse(c: {
  id: string;
  name?: string | null;
  carrier?: string | null;
}): CounterpartyCourse {
  const raw = c.carrier ?? normalizeCarrierFromCourseName(String(c.name ?? ""));
  const carrier: "YAMATO" | "AMAZON" | "OTHER" =
    raw === "YAMATO" || raw === "AMAZON" || raw === "OTHER" ? raw : "OTHER";
  return { id: String(c.id), name: String(c.name ?? ""), carrier };
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const range = getMonthRange(monthParam);

  const { data: addresses, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id, name, billing_notes")
    .eq("company_code", user.companyCode)
    .order("name");

  if (addrErr) {
    console.error(addrErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const { data: courses, error: courseErr } = await supabase
    .from("courses")
    .select("id, name, carrier, counterparty_invoice_address_id")
    .not("counterparty_invoice_address_id", "is", null);

  if (courseErr) {
    console.error(courseErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const byCounterparty = new Map<string, CounterpartyCourse[]>();
  const courseById = new Map<
    string,
    { id: string; name: string; carrier: "YAMATO" | "AMAZON" | "OTHER"; counterpartyId: string }
  >();
  (courses ?? []).forEach((c: Record<string, unknown>) => {
    const cp = c.counterparty_invoice_address_id as string | null;
    if (!cp) return;
    const row = toCounterpartyCourse({
      id: String(c.id),
      name: c.name as string | null,
      carrier: c.carrier as string | null,
    });
    const list = byCounterparty.get(cp) ?? [];
    list.push(row);
    byCounterparty.set(cp, list);
    courseById.set(row.id, {
      id: row.id,
      name: row.name,
      carrier: row.carrier,
      counterpartyId: cp,
    });
  });

  // 取引先ごとのシステム売上を一括計算（N+1クエリ回避）
  const systemRevenueByAddr = new Map<string, number>();
  const linkedCourseIds = Array.from(courseById.keys());
  if (linkedCourseIds.length > 0) {
    const { data: courseRates, error: rateErr } = await supabase
      .from("course_rates")
      .select(
        "course_id, takuhaibin_revenue, nekopos_revenue, fixed_revenue, fixed_profit",
      );
    if (rateErr) {
      console.error(rateErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    const rateByCourse = new Map<
      string,
      {
        takuhaibin_revenue: number;
        nekopos_revenue: number;
        fixed_revenue: number;
        fixed_profit: number;
      }
    >();
    (courseRates ?? []).forEach((r: Record<string, unknown>) => {
      const id = String(r.course_id ?? "");
      if (!id) return;
      rateByCourse.set(id, {
        takuhaibin_revenue: Number(r.takuhaibin_revenue) || 0,
        nekopos_revenue: Number(r.nekopos_revenue) || 0,
        fixed_revenue: Number(r.fixed_revenue) || 0,
        fixed_profit: Number(r.fixed_profit) || 0,
      });
    });

    const { data: shifts, error: shiftsErr } = await supabase
      .from("shifts")
      .select("shift_date, course_id, driver_id")
      .gte("shift_date", range.startDate)
      .lte("shift_date", range.endDate)
      .in("course_id", linkedCourseIds);
    if (shiftsErr) {
      console.error(shiftsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { data: reports, error: reportsErr } = await supabase
      .from("daily_reports")
      .select("driver_id, report_date, takuhaibin_completed, nekopos_completed")
      .gte("report_date", range.startDate)
      .lte("report_date", range.endDate)
      .not("approved_at", "is", null);
    if (reportsErr) {
      console.error(reportsErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    const reportMap = new Map<string, Record<string, unknown>>();
    (reports ?? []).forEach((r: Record<string, unknown>) => {
      const key = `${String(r.driver_id ?? "")}:${String(r.report_date ?? "")}`;
      reportMap.set(key, r);
    });

    (shifts ?? []).forEach((s: Record<string, unknown>) => {
      const courseId = String(s.course_id ?? "");
      const driverId = String(s.driver_id ?? "");
      const date = String(s.shift_date ?? "");
      if (!courseId || !driverId || !date) return;
      const course = courseById.get(courseId);
      if (!course) return;
      const rate = rateByCourse.get(courseId);
      if (!rate) return;
      const rep = reportMap.get(`${driverId}:${date}`);
      if (!rep) return;
      const revenue =
        rate.fixed_revenue > 0
          ? rate.fixed_revenue
          : (Number(rep.takuhaibin_completed) || 0) * rate.takuhaibin_revenue +
            (Number(rep.nekopos_completed) || 0) * rate.nekopos_revenue;
      if (revenue <= 0) return;
      systemRevenueByAddr.set(
        course.counterpartyId,
        (systemRevenueByAddr.get(course.counterpartyId) ?? 0) + revenue,
      );
    });
  }

  const { data: customAgg, error: customErr } = await supabase
    .from("counterparty_monthly_custom_lines")
    .select("invoice_address_id, quantity, unit_price, row_kind")
    .eq("company_code", user.companyCode)
    .eq("month_yyyy_mm", range.month);

  if (customErr) {
    console.error(customErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const customMainByAddr = new Map<string, number>();
  const customDedByAddr = new Map<string, number>();
  (customAgg ?? []).forEach((row: Record<string, unknown>) => {
    const id = String(row.invoice_address_id ?? "");
    if (!id) return;
    const amt = (Number(row.quantity) || 0) * (Number(row.unit_price) || 0);
    const rk = String(row.row_kind ?? "main");
    if (rk === "deduction") {
      customDedByAddr.set(id, (customDedByAddr.get(id) ?? 0) + amt);
    } else {
      customMainByAddr.set(id, (customMainByAddr.get(id) ?? 0) + amt);
    }
  });

  const { data: slRows, error: slErr } = await supabase
    .from("sales_log_entries")
    .select("counterparty_invoice_address_id, revenue, profit")
    .gte("log_date", range.startDate)
    .lte("log_date", range.endDate)
    .not("counterparty_invoice_address_id", "is", null);

  if (slErr) {
    console.error(slErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const slPlusByAddr = new Map<string, number>();
  const slMinusByAddr = new Map<string, number>();
  (slRows ?? []).forEach((row: Record<string, unknown>) => {
    const id = String(row.counterparty_invoice_address_id ?? "");
    if (!id) return;
    const rev = Number(row.revenue) || 0;
    const prof = Number(row.profit) || 0;
    if (rev > 0) slPlusByAddr.set(id, (slPlusByAddr.get(id) ?? 0) + rev);
    if (prof < 0) slMinusByAddr.set(id, (slMinusByAddr.get(id) ?? 0) - prof);
  });

  const rows = (addresses ?? []).map((a: { id: string; name: string; billing_notes: string | null }) => {
      const linked = byCounterparty.get(a.id) ?? [];
      const courseCount = linked.length;
      const systemRevenue = Math.round((systemRevenueByAddr.get(a.id) ?? 0) * 100) / 100;
      const customMainTotal = Math.round((customMainByAddr.get(a.id) ?? 0) * 100) / 100;
      const customDeductionTotal = Math.round((customDedByAddr.get(a.id) ?? 0) * 100) / 100;
      const salesLogRevenueTotal = Math.round((slPlusByAddr.get(a.id) ?? 0) * 100) / 100;
      const salesLogDeductionTotal = Math.round((slMinusByAddr.get(a.id) ?? 0) * 100) / 100;
      const monthTotal = Math.round(
        (systemRevenue +
          salesLogRevenueTotal +
          customMainTotal -
          salesLogDeductionTotal -
          customDeductionTotal) *
          100
      ) / 100;
      const suggestedSection = courseCount > 0 ? dominantSectionFromCourses(linked) : "ヤマト運輸";

      return {
        id: a.id,
        name: a.name,
        billingNotes: a.billing_notes ?? "",
        courseCount,
        courses: linked,
        systemRevenue,
        salesLogRevenueTotal,
        salesLogDeductionTotal,
        customMainTotal,
        customDeductionTotal,
        monthTotal,
        suggestedSection,
      };
    });

  rows.sort((a, b) => {
    const ac = a.courseCount > 0 ? 1 : 0;
    const bc = b.courseCount > 0 ? 1 : 0;
    if (bc !== ac) return bc - ac;
    return a.name.localeCompare(b.name, "ja");
  });

  return NextResponse.json({ month: range.month, rows });
}
