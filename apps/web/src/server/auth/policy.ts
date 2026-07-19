import type { Capability, OwnPermission } from "./capabilities";

// ============================================================
// 認可モデル — スコープ付き権限判定の純粋ポリシー（own / any）。
// DB もリクエストも import しない（テスト・ハコ虎AI のツールガードから直接使う）。
// HTTP ルート向けの解決・ガードは authorize.ts。
//   設計: docs/platform-design.md §2-6
// ============================================================

export type PermissionScope = "own" | "any";

/** メンバーが持つ権限の全体像（1回の解決結果） */
export type Grants = {
  capabilities: Set<Capability>;
  ownPermissions: Set<OwnPermission>;
  worksAsDriver: boolean;
};

/**
 * 認可の要求仕様。any / own の少なくとも一方を指定する。
 * - any: この capability を持てば org 全体スコープで許可
 * - own: この own 権限を持ち、かつ対象所有者が本人なら許可
 * - ownerDriverId: 対象リソースの所有者。省略時は「本人自身が対象」とみなす
 */
export type PermissionSpec = {
  any?: Capability;
  own?: OwnPermission;
  ownerDriverId?: string;
};

/**
 * 純関数の権限判定（正本）。
 * RBAC（ロール＝capability の束）では「updateShift はできるが他人には不可」を
 * 表現できないため、判定を「権限 × 対象リソースの所有者」の2軸で行う。
 * ハコ虎AI は「委任トークンの権限 ∩ 本人の解決済み権限」をこの関数に通す（減衰）。
 */
export function checkPermission(
  grants: Grants,
  actorDriverId: string,
  spec: PermissionSpec,
): { allowed: boolean; scope?: PermissionScope } {
  if (spec.any && grants.capabilities.has(spec.any)) {
    return { allowed: true, scope: "any" };
  }
  if (spec.own && grants.ownPermissions.has(spec.own)) {
    const owner = spec.ownerDriverId ?? actorDriverId;
    if (owner === actorDriverId) {
      return { allowed: true, scope: "own" };
    }
  }
  return { allowed: false };
}
