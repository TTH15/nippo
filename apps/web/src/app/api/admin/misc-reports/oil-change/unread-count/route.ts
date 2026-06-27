import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const { count, error } = await supabase
      .from("oil_change_reports")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("approved_at", null)
      .is("rejected_at", null);

    if (error) {
      console.error("[admin/misc-reports/oil-change/unread-count] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ unreadCount: count ?? 0 });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change/unread-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
