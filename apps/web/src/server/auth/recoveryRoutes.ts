import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, isAuthError } from "./index";
import { requirePlatformAdmin } from "@/server/platform";
import { supabase } from "@/server/db/client";
import { hasRecentAuth } from "./recentAuth";
import { recoverySessionHash } from "./passkeyPolicy";
import { afterSafely } from "@/server/afterSafely";
import { deliverStoredNotifications } from "@/server/notifications/dispatch";
import type { AuthUser } from "./types";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const unavailable = () => NextResponse.json({ error: "復旧申請を確認できませんでした。時間をおいてお試しください" }, { status: 503, headers });
const required = () => NextResponse.json({ error: "もう一度本人確認をしてください", code: "RECENT_AUTH_REQUIRED" }, { status: 403, headers });
export async function ownRecovery(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (!user.identityId || !user.orgId) return NextResponse.json({ error: "所属を確認できません" }, { status: 403, headers });
  try {
    if (req.method === "POST") {
      if (!await hasRecentAuth(req, user)) return required();
      const { data, error } = await supabase.rpc("request_account_recovery", { p_driver_id: user.driverId, p_identity_id: user.identityId,
        p_org_id: user.orgId, p_version: user.tokenVersion ?? 0, p_session_hash: recoverySessionHash(req, user) });
      if (error || !data?.id) return unavailable();
      if (data.notificationId) afterSafely(() => deliverStoredNotifications(user.orgId!, [data.notificationId]));
      return NextResponse.json({ request: { id: data.id, status: data.status, expiresAt: data.expiresAt } }, { headers });
    }
    const { data, error } = await supabase.from("account_recovery_requests").select("id, status, expires_at")
      .eq("driver_id", user.driverId).eq("identity_id", user.identityId).eq("org_id", user.orgId)
      .eq("token_version", user.tokenVersion ?? 0).eq("session_hash", recoverySessionHash(req, user)).maybeSingle();
    if (error) return unavailable();
    return NextResponse.json({ request: data ? { id: data.id, status: new Date(data.expires_at).getTime() <= Date.now() ? "expired" : data.status, expiresAt: data.expires_at } : null }, { headers });
  } catch { return unavailable(); }
}

async function approver(req: NextRequest, platform: boolean): Promise<AuthUser | NextResponse> {
  if (platform) {
    const ctx = await requirePlatformAdmin(req);
    return ctx instanceof NextResponse ? ctx : ctx.user;
  }
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (user.purpose !== "admin" || !user.orgId) return NextResponse.json({ error: "管理画面にログインし直してください" }, { status: 401 });
  const { data: driver, error } = await supabase.from("drivers").select("role_id").eq("id", user.driverId).eq("org_id", user.orgId).maybeSingle();
  if (error) return unavailable();
  const { data: role, error: roleError } = await supabase.from("roles").select("id").eq("id", driver?.role_id).eq("org_id", user.orgId).eq("key", "ADMIN").eq("is_system", true).maybeSingle();
  if (roleError) return unavailable();
  return role ? user : NextResponse.json({ error: "管理者だけが復旧を承認できます" }, { status: 403 });
}

export function recoveryDecisions(platform = false) {
  return async (req: NextRequest) => {
    try {
      const user = await approver(req, platform);
      if (user instanceof NextResponse) return user;
      if (req.method === "GET") {
        // tenant-scope-ok: 同社管理者は直後のorg_id条件で制限。全社閲覧はrequirePlatformAdmin通過時のみ。
        let query = supabase.from("account_recovery_requests").select("id, driver_id, identity_id, org_id, created_at, expires_at, status, drivers!account_recovery_requests_driver_id_fkey(name), organizations(name)")
          .eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(100);
        if (!platform) query = query.eq("org_id", user.orgId); // tenant-scope-ok: プラットフォーム認可済みのみ全社の復旧を閲覧する
        const { data, error } = await query;
        if (error) return unavailable();
        return NextResponse.json({ requests: (data ?? []).map(r => ({ id: r.id, name: (r.drivers as unknown as { name: string } | null)?.name ?? "担当者", orgId: r.org_id,
          companyName: (r.organizations as unknown as { name: string } | null)?.name ?? "会社", requestedAt: r.created_at, expiresAt: r.expires_at, isSelf: r.identity_id === user.identityId })) }, { headers });
      }
      if (!await hasRecentAuth(req, user, "passkey")) return required();
      const body = await req.json().catch(() => null);
      if (!body || typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.approve !== "boolean") return NextResponse.json({ error: "申請を選んでください" }, { status: 400, headers });
      const { data, error } = await supabase.rpc("decide_account_recovery", { p_request_id: body.id, p_actor_driver_id: user.driverId,
        p_actor_identity_id: user.identityId, p_actor_org_id: user.orgId, p_actor_version: user.tokenVersion ?? 0, p_approve: body.approve, p_platform: platform });
      if (error) return NextResponse.json({ error: "承認できませんでした。申請の期限と対象者を確認してください" }, { status: error.code === "42501" ? 403 : error.code === "P0002" ? 409 : 503, headers });
      if (!data?.notificationId || !data?.orgId) return unavailable();
      afterSafely(() => deliverStoredNotifications(data.orgId, [data.notificationId]));
      return NextResponse.json({ ok: true }, { headers });
    } catch { return unavailable(); }
  };
}
