// ============================================================
// プラットフォームコンソールのサーバ基盤（Phase 1・集計のみ / docs/platform-design.md §2-5）
//   - requirePlatformAdmin: identity 基準の入場ガード（org membership とは別軸）
//   - logPlatformAction: 監査ログ（プラットフォーム操作は必ず記録する）
//   - bootstrapOrganization: org 発行の一括処理（organizations + system ロール + 初代 ADMIN 招待）
// ============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabase } from "@/server/db/client";
import { requireAuth, isAuthError, type AuthUser } from "@/server/auth";
import { DEFAULT_ROLE_CAPABILITIES } from "@/server/auth/capabilities";
import { generateJoinCode } from "@/server/tenant/joinCode";

export type PlatformContext = { user: AuthUser; identityId: string };

/**
 * プラットフォーム運営者ガード。トークンの identityId（旧トークンは driver 行から解決）が
 * platform_admins に載っているときだけ通す。org の capability とは独立。
 */
export async function requirePlatformAdmin(req: NextRequest): Promise<PlatformContext | NextResponse> {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;

  let identityId = user.identityId;
  if (!identityId) {
    const { data } = await supabase
      .from("drivers")
      .select("identity_id")
      .eq("id", user.driverId)
      .maybeSingle();
    identityId = (data?.identity_id as string | null) ?? null;
  }
  if (!identityId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: admin } = await supabase
    .from("platform_admins")
    .select("identity_id")
    .eq("identity_id", identityId)
    .maybeSingle();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { user, identityId };
}

/** プラットフォーム操作の監査記録。失敗しても本処理は止めない（ログ欠落はサーバログで検知）。 */
export async function logPlatformAction(
  actorIdentityId: string,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("platform_audit_logs").insert({
    actor_identity_id: actorIdentityId,
    action,
    target: target ?? null,
    detail: detail ?? null,
  });
  if (error) console.error("[platform/audit] 記録に失敗", { action, target, error });
}

export type BootstrapOrgInput = {
  name: string;
  /** 会社コード（organizations.code。短い英数スラッグ。例: ACE） */
  code: string;
  /** 初代 ADMIN 招待の宛先メモ（invites.name） */
  adminInviteName?: string;
};

export type BootstrapOrgResult = {
  orgId: string;
  joinCode: string;
  /** /join?invite=<token> で使う初代 ADMIN 用の単回トークン（14日有効） */
  adminInviteToken: string;
};

/**
 * org 発行の一括処理（§2-5 の 6-7 に相当）。
 *   organizations（status=active・join_code 採番）
 *   → system 既定ロール4種＋capability 束（migration 092 の seed と同内容。正本は DEFAULT_ROLE_CAPABILITIES）
 *   → 初代 ADMIN 用の単回招待（invites。created_by は null＝プラットフォーム発行）
 */
export async function bootstrapOrganization(input: BootstrapOrgInput): Promise<BootstrapOrgResult> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || !name) throw new Error("name と code は必須です");

  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({ code, name, join_code: generateJoinCode(), status: "active" })
    .select("id, join_code")
    .single();
  if (orgErr || !org) throw new Error(`organizations の作成に失敗: ${orgErr?.message}`);

  // system ロール4種（migration 092 と同じ key/label/sort_order）
  const roleDefs = [
    { key: "ADMIN", label: "管理者", sort_order: 10 },
    { key: "ACCOUNTING", label: "経理", sort_order: 20 },
    { key: "ADMIN_VIEWER", label: "管理者（閲覧）", sort_order: 30 },
    { key: "DRIVER", label: "ドライバー", sort_order: 40 },
  ];
  const { data: roles, error: rolesErr } = await supabase
    .from("roles")
    .insert(roleDefs.map((r) => ({ ...r, org_id: org.id, is_system: true })))
    .select("id, key");
  if (rolesErr || !roles) throw new Error(`roles の作成に失敗: ${rolesErr?.message}`);

  const capRows = roles.flatMap((r) =>
    (DEFAULT_ROLE_CAPABILITIES[r.key] ?? []).map((capability) => ({ role_id: r.id, capability })),
  );
  if (capRows.length > 0) {
    const { error: capErr } = await supabase.from("role_capabilities").insert(capRows);
    if (capErr) throw new Error(`role_capabilities の作成に失敗: ${capErr.message}`);
  }

  const adminInviteToken = randomBytes(16).toString("hex");
  const { error: invErr } = await supabase.from("invites").insert({
    org_id: org.id,
    token: adminInviteToken,
    name: input.adminInviteName ?? "初代管理者",
    created_by: null,
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (invErr) throw new Error(`invites の作成に失敗: ${invErr.message}`);

  return { orgId: org.id, joinCode: org.join_code as string, adminInviteToken };
}
