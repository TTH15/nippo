import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { requireAuth, isAuthError } from "./index";
import type { AuthUser } from "./types";
import {
  DEFAULT_ROLE_CAPABILITIES,
  OWN_PERMISSIONS,
  type Capability,
} from "./capabilities";
import { checkPermission, type Grants, type PermissionScope, type PermissionSpec } from "./policy";

// ============================================================
// 認可モデル — スコープ付き権限のリクエストガード（own / any）。
// 判定の正本は policy.ts の純関数 checkPermission。ここは
// 「driverId → Grants の解決（DB）」と「HTTP 401/403 への変換」だけを担う。
//   設計: docs/platform-design.md §2-6
// ============================================================

export { checkPermission } from "./policy";
export type { Grants, PermissionScope, PermissionSpec } from "./policy";

/**
 * driverId から権限の全体像を解決する。
 * capability は role_id → role_capabilities（旧データは role テキストの既定束へ
 * フォールバック）、own 権限は works_as_driver（ドライバーとして扱う）から一括付与。
 * 将来 role 別の own 細分化やパスキー紐づけの個人グラントに正本を移す場合も、
 * この関数の返す Grants の形は変えない。
 */
export async function resolveGrants(driverId: string, fallbackRole?: string): Promise<Grants> {
  const { data: driver } = await supabase
    .from("drivers")
    .select("role, role_id, works_as_driver")
    .eq("id", driverId)
    .maybeSingle();

  let capabilities: Set<Capability>;
  if (driver?.role_id) {
    const { data: caps } = await supabase
      .from("role_capabilities")
      .select("capability")
      .eq("role_id", driver.role_id);
    capabilities = new Set((caps ?? []).map((c) => c.capability as Capability));
  } else {
    const roleKey = driver?.role ?? fallbackRole ?? "";
    capabilities = new Set(DEFAULT_ROLE_CAPABILITIES[roleKey] ?? []);
  }

  // migration 104 未適用の環境でも壊れないよう、role テキスト 'DRIVER' も稼働とみなす。
  const worksAsDriver = driver?.works_as_driver === true || driver?.role === "DRIVER";

  return {
    capabilities,
    ownPermissions: worksAsDriver ? new Set(OWN_PERMISSIONS) : new Set(),
    worksAsDriver,
  };
}

/**
 * 認証 + スコープ付き権限チェック。満たさなければ 403。
 * 許可時は AuthUser に解決済みスコープを添えて返す。ルートは scope === "own" のとき
 * クエリを本人のリソースに絞る（any のときは対象を広げてよい）。
 */
export async function requireScopedPermission(
  req: NextRequest,
  spec: PermissionSpec,
): Promise<(AuthUser & { scope: PermissionScope }) | NextResponse> {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;

  const grants = await resolveGrants(user.driverId, user.role);
  const result = checkPermission(grants, user.driverId, spec);
  if (!result.allowed || !result.scope) {
    console.log(
      `[Auth] Forbidden: required any=${spec.any ?? "-"} own=${spec.own ?? "-"}, role=${user.role}`,
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { ...user, scope: result.scope };
}
