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
 * driverId から capability 集合を解決する（login など AuthUser が無い場面でも使える）。
 * role_id が正本。未設定（092 適用前/未バックフィル）のみ role テキストの既定束へフォールバック。
 */
export async function resolveCapabilities(
  driverId: string,
  fallbackRole?: string,
): Promise<Set<Capability>> {
  const { data: driver } = await supabase
    .from("drivers")
    .select("role, role_id")
    .eq("id", driverId)
    .maybeSingle();

  if (driver?.role_id) {
    const { data: caps } = await supabase
      .from("role_capabilities")
      .select("capability")
      .eq("role_id", driver.role_id);
    return new Set((caps ?? []).map((c) => c.capability as Capability));
  }

  const roleKey = driver?.role ?? fallbackRole ?? "";
  return new Set(DEFAULT_ROLE_CAPABILITIES[roleKey] ?? []);
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

  const caps = await getCapabilities(user);
  if (!caps.has(capability)) {
    console.log(`[Auth] Forbidden: required ${capability}, role=${user.role}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // 解決済みの capability を添えて返す。同一リクエスト内で別の capability も
  // 見たいルート（例: 車両一覧の金額可否）が、認可クエリを二重に走らせないため。
  // 既存の呼び出しは AuthUser として扱えるので影響しない。
  return { ...user, capabilities: caps };
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
