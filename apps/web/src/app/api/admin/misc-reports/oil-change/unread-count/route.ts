import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { countOilChangeUnread } from "@/server/adminBadges/counts";

export const dynamic = "force-dynamic";

// バッジ用の単体エンドポイント（互換維持）。通常は /api/admin/badges に統合済み。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  try {
    const unreadCount = await countOilChangeUnread(supabase, orgId);
    return NextResponse.json({ unreadCount });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change/unread-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
