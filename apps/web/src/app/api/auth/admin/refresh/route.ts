import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { verifyAdminRenew } from "@/server/auth/adminRenew";
import { supabase } from "@/server/db/client";
import { issueAdminSession, type ActiveDriverRow } from "@/server/identity";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (user.purpose !== "work") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const renewal = await verifyAdminRenew(req);
  if (!renewal || renewal.driverId !== user.driverId ||
      renewal.identityId !== user.identityId || renewal.orgId !== user.orgId ||
      renewal.tokenVersion !== user.tokenVersion) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: driver, error } = await supabase
    // tenant-scope-ok: 署名済みの業務用JWTと更新Cookieが一致した本人のみ取得
    .from("drivers")
    .select("id, name, role, company_code, office_code, driver_code, identity_id, org_id, status, token_version")
    .eq("id", user.driverId)
    .single<ActiveDriverRow>();
  if (error || !driver || driver.status !== "active") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await issueAdminSession(driver);
  if (!token) return NextResponse.json({ error: "運営画面の権限がありません" }, { status: 403 });
  return NextResponse.json({ adminToken: token }, { headers: { "Cache-Control": "no-store" } });
}
