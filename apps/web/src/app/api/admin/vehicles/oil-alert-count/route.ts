import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { countOilAlert } from "@/server/adminBadges/counts";

export const dynamic = "force-dynamic";

// GET: オイル交換が迫っている（接近 or 要交換）車両の台数（互換維持）。
// 通常は /api/admin/badges に統合済み。しきい値は core/logic/oilChange に集約。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  try {
    const count = await countOilAlert(supabase, orgId);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[admin/vehicles/oil-alert-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
