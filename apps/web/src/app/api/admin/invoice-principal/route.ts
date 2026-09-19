import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
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
  const user = await requirePermission(req, "can_view_billing");
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

  // ★自社のコースを先に確定してから、そのコースのシフトだけを読む。
  //   逆順（シフトを全件読んでからコースで絞る）だと他社のシフトまで読むうえ、
  //   PostgREST の 1000 行上限で黙って切られると使用頻度の多いコースを取り落とす。
  const coursesQuery = supabase
    .from("courses")
    .select("id, sort_order, carrier, principal_invoice_address_id").eq("org_id", orgId);

  const { data: courses, error: coursesErr } =
    carrierParam === "YAMATO"
      ? await coursesQuery.in("carrier", ["YAMATO", "OTHER"])
      : await coursesQuery.eq("carrier", carrierParam);

  if (coursesErr) {
    console.error(coursesErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const orgCourseIds = (courses ?? []).map((c) => c.id).filter(Boolean) as string[];
  if (orgCourseIds.length === 0) {
    return NextResponse.json({ principal_invoice_address_id: null, principal_name: null });
  }

  // 対象期間のシフトから「使われているコース」の頻度を数える
  const { data: shifts, error: shiftsErr } = await supabase
    // tenant-scope-ok: orgCourseIds は自社の courses（.eq("org_id", orgId)）から作った集合
    .from("shifts")
    .select("course_id")
    .in("course_id", orgCourseIds)
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  if (shiftsErr) {
    console.error(shiftsErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 期間内にシフトが1件も無ければ「使われているコース」を決められない（従来どおり null）。
  if ((shifts ?? []).length === 0) {
    return NextResponse.json({ principal_invoice_address_id: null, principal_name: null });
  }

  const courseIdCounts = new Map<string, number>();
  (shifts ?? []).forEach((s: any) => {
    if (!s?.course_id || typeof s.course_id !== "string") return;
    courseIdCounts.set(s.course_id, (courseIdCounts.get(s.course_id) ?? 0) + 1);
  });

  const candidates = (courses ?? [])
    // 期間内に実際に使われたコースだけを候補にする（絞る順序を入れ替える前と同じ集合）
    .filter((c) => courseIdCounts.has(c.id))
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

