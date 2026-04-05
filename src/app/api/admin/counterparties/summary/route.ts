import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import {
  computeCounterpartyMonthRevenue,
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
  });

  const { data: customAgg, error: customErr } = await supabase
    .from("counterparty_monthly_custom_lines")
    .select("invoice_address_id, quantity, unit_price")
    .eq("company_code", user.companyCode)
    .eq("month_yyyy_mm", range.month);

  if (customErr) {
    console.error(customErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const customTotalByAddr = new Map<string, number>();
  (customAgg ?? []).forEach((row: Record<string, unknown>) => {
    const id = String(row.invoice_address_id ?? "");
    if (!id) return;
    const amt = (Number(row.quantity) || 0) * (Number(row.unit_price) || 0);
    customTotalByAddr.set(id, (customTotalByAddr.get(id) ?? 0) + amt);
  });

  const rows = await Promise.all(
    (addresses ?? []).map(async (a: { id: string; name: string; billing_notes: string | null }) => {
      const linked = byCounterparty.get(a.id) ?? [];
      const courseCount = linked.length;
      let systemRevenue = 0;
      if (courseCount > 0) {
        systemRevenue = await computeCounterpartyMonthRevenue(
          supabase,
          range.startDate,
          range.endDate,
          a.id
        );
      }
      const customLinesTotal = Math.round((customTotalByAddr.get(a.id) ?? 0) * 100) / 100;
      const monthTotal = Math.round((systemRevenue + customLinesTotal) * 100) / 100;
      const suggestedSection = courseCount > 0 ? dominantSectionFromCourses(linked) : "ヤマト運輸";

      return {
        id: a.id,
        name: a.name,
        billingNotes: a.billing_notes ?? "",
        courseCount,
        courses: linked,
        systemRevenue,
        customLinesTotal,
        monthTotal,
        suggestedSection,
      };
    })
  );

  rows.sort((a, b) => {
    const ac = a.courseCount > 0 ? 1 : 0;
    const bc = b.courseCount > 0 ? 1 : 0;
    if (bc !== ac) return bc - ac;
    return a.name.localeCompare(b.name, "ja");
  });

  return NextResponse.json({ month: range.month, rows });
}
