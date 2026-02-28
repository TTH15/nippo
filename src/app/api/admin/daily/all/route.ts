import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type ReportEntry = {
  driver: { id: string; name: string; display_name: string | null };
  report: Record<string, unknown>;
};

type ReportGroup = {
  date: string;
  entries: ReportEntry[];
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  try {
    let query = supabase
      .from("daily_reports")
      .select("*")
      .order("report_date", { ascending: false })
      .order("submitted_at", { ascending: false });

    if (startParam && endParam) {
      query = query.gte("report_date", startParam).lte("report_date", endParam);
    }

    const { data: allReports, error: reportErr } = await query;

    if (reportErr) {
      console.error("[admin/daily/all] reports error", reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const rows = allReports ?? [];
    if (!rows.length) {
      return NextResponse.json({ groups: [] });
    }

    const driverIds = Array.from(new Set(rows.map((r: { driver_id: string }) => r.driver_id).filter(Boolean)));
    const { data: drivers, error: driverErr } = await supabase
      .from("drivers")
      .select("id, name, display_name")
      .in("id", driverIds);

    if (driverErr) {
      console.error("[admin/daily/all] drivers error", driverErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const driverMap = new Map<string, { id: string; name: string; display_name: string | null }>();
    (drivers ?? []).forEach((d: { id: string; name: string; display_name: string | null }) => {
      driverMap.set(d.id, { id: d.id, name: d.name, display_name: d.display_name ?? null });
    });

    const grouped = new Map<string, ReportEntry[]>();
    rows.forEach((r: Record<string, unknown> & { report_date: string; driver_id: string }) => {
      const date = String(r.report_date);
      const driver = driverMap.get(r.driver_id);
      if (!driver) return;
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date)!.push({ driver, report: r });
    });

    const groups: ReportGroup[] = Array.from(grouped.entries())
      .sort(([d1], [d2]) => (d1 < d2 ? 1 : d1 > d2 ? -1 : 0))
      .map(([date, entries]) => ({ date, entries }));

    return NextResponse.json({ groups });
  } catch (err) {
    console.error("[admin/daily/all] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
