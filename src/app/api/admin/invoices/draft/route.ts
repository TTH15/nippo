import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { buildCounterpartyBillingSnapshot } from "@/server/billing/counterpartyBillingSnapshot";

export const dynamic = "force-dynamic";

type Section = "Amazon" | "ヤマト運輸" | "郵便局";

function sectionCode(section: Section) {
  if (section === "Amazon") return "AMZ";
  if (section === "ヤマト運輸") return "YMT";
  return "PST";
}

function normalizeCounterpartyToken(name: string | null | undefined) {
  const token = String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return token || null;
}

function buildInvoiceNo(params: {
  month: string;
  section: Section;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
}) {
  const ym = params.month.replace("-", "");
  const sec = sectionCode(params.section);
  const byName = normalizeCounterpartyToken(params.counterpartyName);
  const byId = params.counterpartyId
    ? params.counterpartyId.replace(/-/g, "").slice(0, 4).toUpperCase()
    : null;
  const cp = byName || byId || "GEN";
  return `INV-${ym}-${sec}-${cp}`;
}

async function buildNextInvoiceNo(
  companyCode: string,
  params: {
    month: string;
    section: Section;
    counterpartyId?: string | null;
    counterpartyName?: string | null;
  }
): Promise<string> {
  const base = buildInvoiceNo(params);
  const prefix = `${base}-R`;
  const { data, error } = await supabase
    .from("invoice_documents")
    .select("invoice_no")
    .eq("company_code", companyCode)
    .like("invoice_no", `${prefix}%`)
    .limit(300);
  if (error) throw error;
  const maxRevision = (data ?? []).reduce((max, row: Record<string, unknown>) => {
    const no = String(row.invoice_no ?? "");
    const m = no.match(new RegExp(`^${prefix}(\\d{2})$`));
    if (!m) return max;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return max;
    return Math.max(max, n);
  }, -1);
  const next = Math.min(maxRevision + 1, 99);
  return `${prefix}${String(next).padStart(2, "0")}`;
}

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

function nextMonthEndDate(month: string): string {
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const ny = mm === 12 ? y + 1 : y;
  const nm = mm === 12 ? 1 : mm + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function sectionToCarrier(section: Section): "YAMATO" | "AMAZON" | "OTHER" {
  if (section === "Amazon") return "AMAZON";
  if (section === "ヤマト運輸") return "YAMATO";
  return "OTHER";
}

function normalizeCarrierFromCourseName(courseName: string) {
  if (!courseName) return "OTHER";
  if (courseName.startsWith("ヤマト")) return "YAMATO";
  if (courseName.startsWith("Amazon") || courseName.startsWith("アマゾン")) return "AMAZON";
  return "OTHER";
}

async function computeTotalForSection(startDate: string, endDate: string, section: Section) {
  type CourseRate = {
    course_id: string;
    takuhaibin_revenue: number;
    takuhaibin_profit: number;
    nekopos_revenue: number;
    nekopos_profit: number;
    fixed_revenue: number;
    fixed_profit: number;
  };

  const { data: courseRates, error: rateErr } = await supabase
    .from("course_rates")
    .select("course_id, takuhaibin_revenue, takuhaibin_profit, nekopos_revenue, nekopos_profit, fixed_revenue, fixed_profit");
  if (rateErr) throw rateErr;

  const rateByCourse: Record<string, CourseRate> = {};
  (courseRates ?? []).forEach((r) => {
    rateByCourse[(r as any).course_id] = {
      course_id: (r as any).course_id,
      takuhaibin_revenue: Number((r as any).takuhaibin_revenue) || 0,
      takuhaibin_profit: Number((r as any).takuhaibin_profit) || 0,
      nekopos_revenue: Number((r as any).nekopos_revenue) || 0,
      nekopos_profit: Number((r as any).nekopos_profit) || 0,
      fixed_revenue: Number((r as any).fixed_revenue) || 0,
      fixed_profit: Number((r as any).fixed_profit) || 0,
    };
  });

  const { data: courses, error: coursesErr } = await supabase.from("courses").select("id, name, carrier");
  if (coursesErr) throw coursesErr;

  const courseMap = new Map<string, {
    id: string;
    name: string;
    carrier?: "YAMATO" | "AMAZON" | "OTHER" | null;
    counterparty_invoice_address_id?: string | null;
  }>();
  (courses ?? []).forEach((c: any) => {
    courseMap.set(String(c.id), {
      id: String(c.id),
      name: String(c.name ?? ""),
      carrier: c.carrier ?? null,
      counterparty_invoice_address_id: c.counterparty_invoice_address_id ?? null,
    });
  });

  // OTHER は sales_log_entries（COMPANY）で作る（admin/sales の other 定義に合わせる）
  if (section === "郵便局") {
    const { data: otherRows, error: otherErr } = await supabase
      .from("sales_log_entries")
      .select("revenue, log_date, attribution")
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .eq("attribution", "COMPANY");
    if (otherErr) throw otherErr;
    let total = 0;
    (otherRows ?? []).forEach((row: any) => {
      const revenue = Number(row.revenue) || 0;
      if (revenue > 0) total += revenue;
    });
    return total;
  }

  const { data: shifts, error: shiftsErr } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);
  if (shiftsErr) throw shiftsErr;

  const { data: reports, error: reportsErr } = await supabase
    .from("daily_reports")
    .select("driver_id, report_date, takuhaibin_completed, nekopos_completed")
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null);
  if (reportsErr) throw reportsErr;

  const reportMap = new Map<string, any>();
  (reports ?? []).forEach((r: any) => reportMap.set(`${r.driver_id}:${r.report_date}`, r));

  let total = 0;
  const targetCarrier = sectionToCarrier(section); // Amazon or YAMATO

  (shifts ?? []).forEach((s: any) => {
    if (!s?.driver_id || !s?.course_id) return;
    const date = s.shift_date as string;
    const driverId = s.driver_id as string;
    const courseId = s.course_id as string;

    const rep = reportMap.get(`${driverId}:${date}`);
    if (!rep) return;

    const rate = rateByCourse[courseId];
    if (!rate) return;

    const course = courseMap.get(courseId);
    const carrier: "YAMATO" | "AMAZON" | "OTHER" =
      (course?.carrier as any) ?? normalizeCarrierFromCourseName(course?.name ?? "");

    if (rate.fixed_revenue > 0) {
      // Amazon固定売上は固定売上を carrier に応じて振り分け
      const revenue = rate.fixed_revenue;
      if (targetCarrier === "AMAZON") {
        if (carrier === "AMAZON") total += revenue;
      } else {
        // ヤマト運輸側に入れる（Amazon以外）
        if (carrier !== "AMAZON") total += revenue;
      }
      return;
    }

    const tkComp = Number(rep.takuhaibin_completed ?? 0) || 0;
    const nkComp = Number(rep.nekopos_completed ?? 0) || 0;
    const revenue = tkComp * rate.takuhaibin_revenue + nkComp * rate.nekopos_revenue;

    if (targetCarrier === "AMAZON") {
      if (carrier === "AMAZON") total += revenue;
    } else {
      if (carrier !== "AMAZON") total += revenue;
    }
  });

  return total;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const sectionParamRaw = req.nextUrl.searchParams.get("section");
  const section: Section =
    sectionParamRaw === "Amazon" || sectionParamRaw === "ヤマト運輸" || sectionParamRaw === "郵便局"
      ? sectionParamRaw
      : "ヤマト運輸";

  const range = getMonthRange(monthParam);
  const issueDate = nextMonthEndDate(range.month);
  const counterpartyParam = req.nextUrl.searchParams.get("counterparty")?.trim() ?? "";

  if (counterpartyParam && UUID_RE.test(counterpartyParam)) {
    const { data: addr, error: addrErr } = await supabase
      .from("invoice_addresses")
      .select("id, name")
      .eq("id", counterpartyParam)
      .eq("company_code", user.companyCode)
      .maybeSingle();

    if (addrErr) {
      console.error(addrErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!addr) {
      return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
    }

    const snap = await buildCounterpartyBillingSnapshot(
      supabase,
      user.companyCode,
      counterpartyParam,
      range.startDate,
      range.endDate,
      range.month
    );

    const main: { title: string; qty: number; price: number }[] = snap.mainLines.map((line) => ({
      title: line.label,
      qty: line.quantity,
      price: line.unitPrice,
    }));

    const deduct: { title: string; qty: number; price: number }[] = snap.deductLines.map((line) => ({
      title: line.label,
      qty: line.quantity,
      price: line.unitPrice,
    }));

    if (main.length === 0) {
      main.push({
        title: `${addr.name} ${range.month} 分（明細なし）`,
        qty: 1,
        price: 0,
      });
    }

    const tableData = {
      main,
      deduct,
    };

    return NextResponse.json({
      month: range.month,
      section,
      issueDate,
      invoiceNo: await buildNextInvoiceNo(user.companyCode, {
        month: range.month,
        section,
        counterpartyId: counterpartyParam,
        counterpartyName: addr.name,
      }),
      counterparty_invoice_address_id: counterpartyParam,
      tableData,
    });
  }

  const total = await computeTotalForSection(range.startDate, range.endDate, section);

  // section と月内シフトから、請求先ID（取引先ID）を頻度ベースで決める
  const { data: shiftsForTo } = await supabase
    .from("shifts")
    .select("course_id, shift_date")
    .gte("shift_date", range.startDate)
    .lte("shift_date", range.endDate);
  const { data: coursesForTo } = await supabase
    .from("courses")
    .select("id, name, carrier, counterparty_invoice_address_id")
    .in("id", Array.from(new Set((shiftsForTo ?? []).map((s: any) => s.course_id).filter(Boolean))));
  const cMap = new Map<string, any>();
  (coursesForTo ?? []).forEach((c: any) => cMap.set(c.id, c));
  const targetCarrier = sectionToCarrier(section);
  const counterpartyCount = new Map<string, number>();
  (shiftsForTo ?? []).forEach((s: any) => {
    const c = cMap.get(s.course_id);
    if (!c) return;
    const carrier = c.carrier ?? normalizeCarrierFromCourseName(c.name ?? "");
    const isTarget =
      targetCarrier === "YAMATO" ? carrier !== "AMAZON" : carrier === targetCarrier;
    if (!isTarget) return;
    const toId = c.counterparty_invoice_address_id as string | null;
    if (!toId) return;
    counterpartyCount.set(toId, (counterpartyCount.get(toId) ?? 0) + 1);
  });
  const sortedTo = Array.from(counterpartyCount.entries()).sort((a, b) => b[1] - a[1]);
  const counterpartyInvoiceAddressId = sortedTo.length > 0 ? sortedTo[0][0] : null;

  const tableData = {
    main: [
      {
        title: `${section} ${range.month} 売上`,
        qty: 1,
        price: total,
      },
    ],
    deduct: [],
  };

  return NextResponse.json({
    month: range.month,
    section,
    issueDate,
    invoiceNo: await buildNextInvoiceNo(user.companyCode, {
      month: range.month,
      section,
      counterpartyId: counterpartyInvoiceAddressId,
    }),
    counterparty_invoice_address_id: counterpartyInvoiceAddressId,
    tableData,
  });
}

