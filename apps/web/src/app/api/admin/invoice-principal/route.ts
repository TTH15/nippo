import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): { startDate: string; endDate: string } {
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
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function sectionToCarrier(section: string | null): "YAMATO" | "AMAZON" | "OTHER" | null {
  if (!section) return null;
  if (section === "Amazon") return "AMAZON";
  if (section === "ヤマト運輸") return "YAMATO";
  if (section === "郵便局") return "OTHER";
  return null;
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const monthParam = req.nextUrl.searchParams.get("month");
  const carrierParamRaw = req.nextUrl.searchParams.get("carrier");
  const sectionParamRaw = req.nextUrl.searchParams.get("section");

  const carrierParam =
    carrierParamRaw === "YAMATO" || carrierParamRaw === "AMAZON" || carrierParamRaw === "OTHER"
      ? carrierParamRaw
      : sectionToCarrier(sectionParamRaw);

  if (!monthParam || !carrierParam) {
    return NextResponse.json(
      { error: "month(YYYY-MM) と carrier(または section) が必要です" },
      { status: 400 },
    );
  }

  const { startDate, endDate } = getMonthRange(monthParam);

  // 対象期間のシフトから「使われているコース」を抽出
  const { data: shifts, error: shiftsErr } = await supabase
    .from("shifts")
    .select("course_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  if (shiftsErr) {
    console.error(shiftsErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const courseIds = Array.from(
    new Set((shifts ?? []).map((s) => s.course_id).filter((id) => typeof id === "string" && id.length > 0)),
  );

  if (courseIds.length === 0) {
    return NextResponse.json({ principal_invoice_address_id: null, principal_name: null });
  }

  const courseIdCounts = new Map<string, number>();
  (shifts ?? []).forEach((s: any) => {
    if (!s?.course_id || typeof s.course_id !== "string") return;
    courseIdCounts.set(s.course_id, (courseIdCounts.get(s.course_id) ?? 0) + 1);
  });

  const coursesQuery = supabase
    .from("courses")
    .select("id, sort_order, carrier, principal_invoice_address_id")
    .in("id", courseIds);

  const { data: courses, error: coursesErr } =
    carrierParam === "YAMATO"
      ? await coursesQuery.in("carrier", ["YAMATO", "OTHER"])
      : await coursesQuery.eq("carrier", carrierParam);

  if (coursesErr) {
    console.error(coursesErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const candidates = (courses ?? [])
    .filter((c) => (c as any).principal_invoice_address_id)
    .sort((a: any, b: any) => {
      const ca = courseIdCounts.get(a.id) ?? 0;
      const cb = courseIdCounts.get(b.id) ?? 0;
      if (cb !== ca) return cb - ca; // 利用頻度が多いコースを優先
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

  const chosenCourse = candidates[0] as any | undefined;
  const principalId = chosenCourse?.principal_invoice_address_id as string | null | undefined;

  if (!principalId) {
    return NextResponse.json({ principal_invoice_address_id: null, principal_name: null });
  }

  const { data: invoiceAddr, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id, name")
    .eq("id", principalId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (addrErr) {
    console.error(addrErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    principal_invoice_address_id: principalId,
    principal_name: invoiceAddr?.name ?? null,
  });
}

