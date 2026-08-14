import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { countLicenseAlert } from "@/server/adminBadges/counts";

export const dynamic = "force-dynamic";

// GET: 運転免許証の更新が迫っている（接近 or 期限切れ）ドライバーの人数（互換維持）。
// 通常は /api/admin/badges に統合済み。しきい値は core/logic/license に集約。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  try {
    const count = await countLicenseAlert(supabase, orgId);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[admin/users/license-alert-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
