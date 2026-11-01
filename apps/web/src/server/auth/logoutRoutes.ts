import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, isAuthError, authProvider } from "./index";
import { clearAdminRenewCookie } from "./adminRenew";
import { requireRecentAuth } from "./recentAuth";
import { supabase } from "@/server/db/client";
import { afterSafely } from "@/server/afterSafely";
import { deliverStoredNotifications } from "@/server/notifications/dispatch";

export function logout(all = false) {
  return async (req: NextRequest) => {
    const user = await requireAuth(req);
    if (isAuthError(user)) { if (user.status === 401) clearAdminRenewCookie(user); return user; }
    if (!user.identityId || !user.orgId || !user.sessionId || !user.sessionExpiresAt) return NextResponse.json({ error: "ログインし直してください" }, { status: 401 });
    if (all) {
      const error = await requireRecentAuth(req, user);
      if (error) return error;
    }
    const sessions = [{ id: user.sessionId, expiresAt: new Date(user.sessionExpiresAt * 1000).toISOString() }];
    const body = await req.json().catch(() => null);
    if (body?.adminToken && typeof body.adminToken === "string") {
      try {
        const other = await authProvider.verify(`Bearer ${body.adminToken}`);
        if (other.purpose === "admin" && other.driverId === user.driverId && other.identityId === user.identityId && other.orgId === user.orgId && other.sessionId && other.sessionExpiresAt) {
          sessions.push({ id: other.sessionId, expiresAt: new Date(other.sessionExpiresAt * 1000).toISOString() });
        }
      } catch { /* 期限切れの運営トークンは既に利用不可。 */ }
    }
    const { data, error } = await supabase.rpc("revoke_auth_sessions", { p_driver_id: user.driverId, p_identity_id: user.identityId, p_org_id: user.orgId,
      p_version: user.tokenVersion ?? 0, p_sessions: sessions, p_all: all });
    if (error || !data?.ok) return NextResponse.json({ error: "ログアウトを完了できませんでした。もう一度お試しください" }, { status: 503 });
    if (data.notificationId) afterSafely(() => deliverStoredNotifications(user.orgId!, [data.notificationId]));
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    clearAdminRenewCookie(response);
    return response;
  };
}
