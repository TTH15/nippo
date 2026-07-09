import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { issueDriverSession, type ActiveDriverRow } from "@/server/identity";

export const dynamic = "force-dynamic";

// GET: 現在のトークンの持ち主について、DB上の最新ロール・capabilityでセッションを再発行する。
// 権限の付与／剥奪はDBには即時反映されるが、ログイン時に発行したJWTやクライアントの
// localStorageキャッシュ（nippo_driver）には反映されない。アプリ起動時にここを叩いて同期する。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, name, role, company_code, office_code, driver_code, identity_id, org_id, status")
    .eq("id", user.driverId)
    .single<ActiveDriverRow>();

  if (!driver || driver.status !== "active") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await issueDriverSession(driver);
  return NextResponse.json(session);
}
