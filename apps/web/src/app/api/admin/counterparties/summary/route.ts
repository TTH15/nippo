import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  dominantSectionFromCourses,
  courseCarrierBucket,
  type CounterpartyCourse,
} from "@/server/billing/computeCounterpartyMonthRevenue";
import { loadAggregationData } from "@/server/aggregation/load";
import { buildContext, buildContributions } from "@/server/aggregation/compute";

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

function toCounterpartyCourse(c: {
  id: string;
  name?: string | null;
  carrierCode?: string | null;
}): CounterpartyCourse {
  return {
    id: String(c.id),
    name: String(c.name ?? ""),
    carrier: courseCarrierBucket(c.carrierCode ?? null),
  };
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const monthParam = req.nextUrl.searchParams.get("month");
  const range = getMonthRange(monthParam);

  const { data: addresses, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id, name, billing_notes")
    .eq("org_id", orgId)
    .order("name");

  if (addrErr) {
    console.error(addrErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const [{ data: courses, error: courseErr }, { data: carrierRows }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, name, carrier_id, counterparty_invoice_address_id")
      // 取引先(invoice_addresses)は org 絞り済みだが、コース側も絞らないと
      // 他社コースが同じ取引先IDを持った場合に件数・売上へ混入する
      .eq("org_id", orgId)
      .not("counterparty_invoice_address_id", "is", null),
    supabase.from("carriers").select("id, code"),
  ]);

  if (courseErr) {
    console.error(courseErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const codeByCarrierId = new Map<string, string | null>();
  (carrierRows ?? []).forEach((c: { id: string; code: string | null }) =>
    codeByCarrierId.set(c.id, c.code ?? null),
  );

  const byCounterparty = new Map<string, CounterpartyCourse[]>();
  const courseById = new Map<
    string,
    { id: string; name: string; carrier: "YAMATO" | "AMAZON" | "OTHER"; counterpartyId: string }
  >();
  (courses ?? []).forEach((c: Record<string, unknown>) => {
    const cp = c.counterparty_invoice_address_id as string | null;
    if (!cp) return;
    const carrierId = c.carrier_id as string | null;
    const row = toCounterpartyCourse({
      id: String(c.id),
      name: c.name as string | null,
      carrierCode: carrierId ? codeByCarrierId.get(carrierId) ?? null : null,
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

  // 取引先ごとのシステム売上を v2 集計エンジンで一括計算（admin/sales と一致・N+1回避）
  const systemRevenueByAddr = new Map<string, number>();
  if (courseById.size > 0) {
    const aggData = await loadAggregationData(supabase, orgId, range.startDate, range.endDate);
    const aggCtx = buildContext(aggData.units, aggData.unitRates, aggData.fixedRates, aggData.fixedRateBundles, aggData.courseRateModes);
    const contribs = buildContributions(aggData.reports, [], aggCtx); // ledger 抜き = system auto のみ
    for (const c of contribs) {
      const course = c.courseId ? courseById.get(c.courseId) : null;
      if (!course) continue;
      systemRevenueByAddr.set(
        course.counterpartyId,
        (systemRevenueByAddr.get(course.counterpartyId) ?? 0) + c.revenue,
      );
    }
  }

  const { data: customAgg, error: customErr } = await supabase
    .from("counterparty_monthly_custom_lines")
    .select("invoice_address_id, quantity, unit_price, row_kind")
    .eq("org_id", orgId)
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
    .eq("org_id", orgId)
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
