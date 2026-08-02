import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { requireAuth, isAuthError } from "./index";
import type { AuthUser } from "./types";
import { DEFAULT_ROLE_CAPABILITIES, type Capability } from "./capabilities";

// ============================================================
// 認可モデル — capability 解決とガード。
// membership(drivers).role_id → role_capabilities を正本に解決し、
// role_id 未設定（旧データ・移行途中）のときは role テキストの既定束へフォールバック。
//   設計: docs/platform-design.md §2-6
// ============================================================

/**
 * その membership が持つ capability 集合を解決する。
 * 機微なゲート（PII/口座/報酬締め）は取消即時性のため都度この解決を使う。
 */
export async function getCapabilities(user: AuthUser): Promise<Set<Capability>> {
  return resolveCapabilities(user.driverId, user.role);
}

/**
 * driverId から capability 集合＋org_id を1回の drivers 参照で解決する。
 * org_id は resolveOrgId と同じく DB（membership 行）が正本。認可で必ず drivers を
 * 引くため、ここで同乗させると各ルートの resolveOrgId の往復を1つ省ける。
 */
async function resolveAuthz(
  driverId: string,
  fallbackRole?: string,
): Promise<{ caps: Set<Capability>; orgId: string | null }> {
  const { data: driver } = await supabase
    .from("drivers")
    .select("role, role_id, org_id")
    .eq("id", driverId)
    .maybeSingle();

  const orgId = (driver?.org_id as string | undefined) ?? null;
  if (driver?.role_id) {
    const { data: caps } = await supabase
      .from("role_capabilities")
      .select("capability")
      .eq("role_id", driver.role_id);
    return { caps: new Set((caps ?? []).map((c) => c.capability as Capability)), orgId };
  }

  const roleKey = driver?.role ?? fallbackRole ?? "";
  return { caps: new Set(DEFAULT_ROLE_CAPABILITIES[roleKey] ?? []), orgId };
}

/**
 * driverId から capability 集合を解決する（login など AuthUser が無い場面でも使える）。
 * role_id が正本。未設定（092 適用前/未バックフィル）のみ role テキストの既定束へフォールバック。
 */
export async function resolveCapabilities(
  driverId: string,
  fallbackRole?: string,
): Promise<Set<Capability>> {
  return (await resolveAuthz(driverId, fallbackRole)).caps;
}

/** その membership が capability を持つかを真偽で返す（UI 出し分け等の補助用）。 */
export async function hasCapability(user: AuthUser, capability: Capability): Promise<boolean> {
  const caps = await getCapabilities(user);
  return caps.has(capability);
}

/**
 * 認証 + capability チェック。満たさなければ 403。
 * requireAuth(role) のロール階層に代わる新ゲート。
 */
export async function requirePermission(
  req: NextRequest,
  capability: Capability,
): Promise<AuthUser | NextResponse> {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;

  const { caps, orgId } = await resolveAuthz(user.driverId, user.role);
  if (!caps.has(capability)) {
    console.log(`[Auth] Forbidden: required ${capability}, role=${user.role}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // 解決済みの capability を添えて返す。同一リクエスト内で別の capability も
  // 見たいルート（例: 車両一覧の金額可否）が、認可クエリを二重に走らせないため。
  // orgId も DB 解決値（resolveOrgId と同じ正本）で上書きする — ルート側は
  // `user.orgId ?? await resolveOrgId(user.driverId)` で往復を1つ省ける。
  // 既存の呼び出しは AuthUser として扱えるので影響しない。
  return { ...user, capabilities: caps, orgId: orgId ?? user.orgId };
}

/**
 * 認証 + capability チェック（いずれか1つを満たせば許可）。
 * 複数ドメインにまたがる操作（例: 車両貸出 = 配車 or 車両管理）に使う。
 */
export async function requireAnyPermission(
  req: NextRequest,
  capabilities: Capability[],
): Promise<AuthUser | NextResponse> {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;

  const { caps, orgId } = await resolveAuthz(user.driverId, user.role);
  if (!capabilities.some((c) => caps.has(c))) {
    console.log(`[Auth] Forbidden: required any of ${capabilities.join("|")}, role=${user.role}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { ...user, capabilities: caps, orgId: orgId ?? user.orgId };
}

/**
 * requirePermission が添えた capability を使う（無ければ取得する）。
 * hasCapability の呼び直しで drivers + role_capabilities を再取得するのを避ける。
 */
export async function hasCapabilityCached(
  user: AuthUser,
  capability: Capability,
): Promise<boolean> {
  if (user.capabilities) return user.capabilities.has(capability);
  return hasCapability(user, capability);
}
