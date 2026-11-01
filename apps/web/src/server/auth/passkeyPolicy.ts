import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { AuthUser } from "./types";
import { supabase } from "@/server/db/client";
import { resolveCapabilities } from "./permissions";
import { hasRecentAuth } from "./recentAuth";

export const recoverySessionHash = (req: NextRequest, user: AuthUser) => createHash("sha256")
  .update(user.sessionId ? `session:${user.sessionId}` : req.headers.get("authorization") ?? "").digest("hex");

/** 別所属の業務セッションから、同じ本人の運営用キーを変更する迂回も防ぐ。 */
export async function isPrivilegedIdentity(user: AuthUser): Promise<boolean> {
  if (!user.identityId) throw new Error("Missing identity");
  const [{ data: members, error }, { data: platform, error: platformError }] = await Promise.all([
    supabase.from("drivers").select("id, role").eq("identity_id", user.identityId).eq("status", "active"), // tenant-scope-ok: 本人の全所属を点検し、運営パスキーの変更条件を弱めない
    supabase.from("platform_admins").select("identity_id").eq("identity_id", user.identityId).maybeSingle(),
  ]);
  if (error || platformError || !members) throw new Error("Identity permissions unavailable");
  if (platform) return true;
  for (const member of members) if ((await resolveCapabilities(member.id, member.role)).size > 0) return true;
  return false;
}

export async function passkeyManagementAuthorization(req: NextRequest, user: AuthUser, allowRecovery = false): Promise<
  { recoveryId?: string } | NextResponse
> {
  try {
    const privileged = await isPrivilegedIdentity(user);
    if (await hasRecentAuth(req, user, privileged ? "passkey" : undefined)) return {};
    const recoveryId = req.headers.get("x-recovery-request");
    if (allowRecovery && privileged && recoveryId && /^[0-9a-f-]{36}$/i.test(recoveryId) && await hasRecentAuth(req, user)) {
      const { data, error } = await supabase.from("account_recovery_requests").select("id, expires_at")
        .eq("id", recoveryId).eq("driver_id", user.driverId).eq("identity_id", user.identityId).eq("org_id", user.orgId)
        .eq("token_version", user.tokenVersion ?? 0).eq("session_hash", recoverySessionHash(req, user)).eq("status", "approved").maybeSingle();
      if (error) throw error;
      if (data && new Date(data.expires_at).getTime() > Date.now()) return { recoveryId: data.id };
    }
    return NextResponse.json({ error: privileged ? "登録済みのパスキーで本人確認するか、管理者に復旧を申請してください" : "かんたんログインを変更する前に、もう一度本人確認をしてください",
      code: privileged ? "PASSKEY_OR_RECOVERY_REQUIRED" : "RECENT_AUTH_REQUIRED" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "本人確認の条件を確認できませんでした。時間をおいてお試しください" }, { status: 503 });
  }
}
