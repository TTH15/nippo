import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("oil_change_reports")
      .update({
        approved_at: null,
        approved_by: null,
        rejected_at: new Date().toISOString(),
        rejected_by: user.driverId,
      })
      .eq("id", id).eq("org_id", orgId);

    if (error) {
      console.error("[admin/misc-reports/oil-change/reject] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { error: cleanupError } = await supabase
      .from("driver_ad_hoc_expenses")
      .delete()
      .eq("misc_report_id", id);

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
