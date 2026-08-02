import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 参加承認待ち（status='pending'）の申請件数。
// メニューバッジ（「ドライバー」→「参加・承認」）に使用。
// 一覧（/api/admin/users?status=pending）と同じ works_as_driver=true で数える。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  try {
    const { count, error } = await supabase
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("works_as_driver", true)
      .eq("status", "pending");

    if (error) {
      console.error("[admin/users/pending-count] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ count: count ?? 0 });
  } catch (err) {
    console.error("[admin/users/pending-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
