import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { data: report, error: reportErr } = await supabase.from("oil_change_reports")
      .select("driver_id").eq("id", id).eq("org_id", orgId).maybeSingle();
    if (reportErr) return NextResponse.json({ error: "DB error" }, { status: 500 });
    if (!report) return NextResponse.json({ error: "報告が見つかりません。" }, { status: 404 });
    const { data: driver, error: driverErr } = await supabase.from("drivers")
      .select("id").eq("id", report.driver_id).eq("org_id", orgId).maybeSingle();
    if (driverErr) return NextResponse.json({ error: "DB error" }, { status: 500 });
    if (!driver) return NextResponse.json({ error: "報告が見つかりません。" }, { status: 404 });

    const { data: rejected, error } = await supabase
      .from("oil_change_reports")
      .update({
        approved_at: null,
        approved_by: null,
        rejected_at: new Date().toISOString(),
        rejected_by: user.driverId,
      })
      .eq("id", id).eq("org_id", orgId).select("id").maybeSingle();

    if (error) {
      console.error("[admin/misc-reports/oil-change/reject] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (!rejected) return NextResponse.json({ error: "報告が見つかりません。" }, { status: 404 });

    const { error: cleanupError } = await supabase
      .from("driver_ad_hoc_expenses")
      .delete()
      .eq("misc_report_id", id).eq("driver_id", report.driver_id);

    if (cleanupError) {
      console.error("[admin/misc-reports/oil-change/reject] cleanup error", cleanupError);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change/reject] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
