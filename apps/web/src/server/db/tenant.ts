// ============================================================
// テナント文脈（org_id）の解決とスコープ強制の入口。
// 構成A（クライアントはNext.js API経由・RLS不使用）のため、テナント分離は
// この層で default-deny に一元化する。Phase 2 の土台。
//   設計: docs/platform-design.md §4,§6,§7 / docs/tenant-migration（memory）
// ============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth, isAuthError, type AuthUser } from "@/server/auth";
import { supabase } from "@/server/db/client";

/**
 * 認証済みドライバー（membership 行）から所属テナントの org_id を解決する。
 * JWT は当面 companyCode しか持たないため、ドライバー行の org_id を正本とする
 * （再ログイン不要・membership モデルと整合）。
 */
export async function resolveOrgId(driverId: string): Promise<string> {
  const { data, error } = await supabase
    .from("drivers")
    .select("org_id")
    .eq("id", driverId)
    .single();
  if (error || !data?.org_id) {
    throw new Error(`org_id を解決できません (driverId=${driverId}): ${error?.message ?? "org_id is null"}`);
  }
  return data.org_id as string;
}

export type TenantContext = { user: AuthUser; orgId: string };

/**
 * requireAuth ＋ org_id 解決をまとめた、テナント付きルートの入口。
 * 認証/認可失敗時は NextResponse を返す（既存 requireAuth と同じ使い勝手）。
 */
export async function requireTenant(
  req: NextRequest,
  selfScope?: "DRIVER",
): Promise<TenantContext | NextResponse> {
  const user = await requireAuth(req, selfScope);
  if (isAuthError(user)) return user;
  // 孤児セッション（token は有効だが driver 行が削除済み等）は org を解決できない。
  // これは認証無効として 401（クライアントはログイン画面へ遷移）にする。生の500を出さない。
  try {
    const orgId = await resolveOrgId(user.driverId);
    return { user, orgId };
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export { isAuthError } from "@/server/auth";

/**
 * リクエスト文脈を持たない開発スクリプト用に、既定テナント(ACE)の org_id を返す。
 * 本番運用コード（API ルート）では使わない。
 */
export async function getDefaultOrgId(): Promise<string> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("code", "ACE")
    .single();
  if (error || !data?.id) {
    throw new Error(`既定テナント(ACE)の org_id を解決できません: ${error?.message ?? "not found"}`);
  }
  return data.id as string;
}
