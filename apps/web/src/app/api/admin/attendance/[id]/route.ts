import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: manual打刻の承認/却下（§8.5）。pending のセッションのみ対象。
// body: { action: "approve" | "reject" }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vehicle_sessions")
    .update({
      approval_status: action === "approve" ? "approved" : "rejected",
      approved_at: new Date().toISOString(),
      approved_by: user.driverId,
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("approval_status", "pending") // 承認待ちのみ
    .select("id, approval_status")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "対象が見つからないか、既に処理済みです" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, approvalStatus: data.approval_status });
}
