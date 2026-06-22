import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { countLicenseAlertDrivers, type LicenseDriver } from "@repo/core/logic/license";

export const dynamic = "force-dynamic";

// GET: 運転免許証の更新が迫っている（接近 or 期限切れ）ドライバーの人数。
// メニューバッジ（「管理」／「ドライバー」）に使用。しきい値は core/logic/license に集約。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("license_expiry_date")
      .eq("org_id", orgId)
      .eq("role", "DRIVER");

    if (error) {
      console.error("[admin/users/license-alert-count] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const count = countLicenseAlertDrivers((data ?? []) as LicenseDriver[]);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[admin/users/license-alert-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
