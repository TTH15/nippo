import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type Entry = {
  driver: { id: string; name: string; display_name: string | null };
  report: Record<string, unknown>;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const { data: reports, error: reportErr } = await supabase
      .from("oil_change_reports")
      .select("*")
      .is("approved_at", null)
      .is("rejected_at", null)
      .order("submitted_at", { ascending: false });

    if (reportErr) {
      console.error("[admin/misc-reports/oil-change] reports error", reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const rows = reports ?? [];
    if (!rows.length) return NextResponse.json({ entries: [] });

    const driverIds = Array.from(new Set(rows.map((r: { driver_id: string }) => r.driver_id).filter(Boolean)));
    const { data: drivers, error: driverErr } = await supabase
      .from("drivers")
      .select("id, name, display_name")
      .in("id", driverIds);

    if (driverErr) {
      console.error("[admin/misc-reports/oil-change] drivers error", driverErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const driverMap = new Map<string, { id: string; name: string; display_name: string | null }>();
    (drivers ?? []).forEach((d: { id: string; name: string; display_name: string | null }) => {
      driverMap.set(d.id, { id: d.id, name: d.name, display_name: d.display_name ?? null });
    });

    const entries: Entry[] = rows
      .map((r: Record<string, unknown> & { driver_id: string }) => {
        const driver = driverMap.get(r.driver_id);
        if (!driver) return null;
        return { driver, report: r };
      })
      .filter((v): v is Entry => v != null);

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
