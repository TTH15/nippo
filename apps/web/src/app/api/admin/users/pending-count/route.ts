import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { countPendingDrivers } from "@/server/adminBadges/counts";

export const dynamic = "force-dynamic";

// GET: 参加承認待ち（status='pending'）の申請件数（互換維持）。
// 通常は /api/admin/badges に統合済み。
// 一覧（/api/admin/users?status=pending）と同じ works_as_driver=true で数える。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  try {
    const count = await countPendingDrivers(supabase, orgId);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[admin/users/pending-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
