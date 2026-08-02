import { NextRequest, NextResponse } from "next/server";
import { authProvider } from "./jwt";
import type { AuthUser } from "./types";

export type { AuthUser, MembershipRole } from "./types";
export { authProvider, signToken } from "./jwt";
export {
  requirePermission,
  requireAnyPermission,
  hasCapability,
  hasCapabilityCached,
  getCapabilities,
  resolveCapabilities,
} from "./permissions";
export {
  checkPermission,
  resolveGrants,
  requireScopedPermission,
  type Grants,
  type PermissionScope,
  type PermissionSpec,
} from "./authorize";
export {
  CAPABILITIES,
  DEFAULT_ROLE_CAPABILITIES,
  CAPABILITY_META,
  CAPABILITY_GROUP_ORDER,
  PERMISSION_ROWS,
  OWN_PERMISSIONS,
  type Capability,
  type OwnPermission,
  type PermissionRow,
} from "./capabilities";

/**
 * 認証（トークン検証）のみを行う入口。認可はしない。
 * - 引数 "DRIVER" は「ドライバー本人系のセルフスコープルート（/api/me/* 等）」の目印。
 *   対象は常にトークンの driverId 自身なので、ロールでは絞らない（旧実装の
 *   DRIVER/ADMIN/ADMIN_VIEWER ホワイトリストは、ACCOUNTING・カスタムロールの
 *   メンバーが自分のプロフィール・日報・Passkey 状態まで 403 になる穴だった）。
 * - 旧 "ADMIN"/"ADMIN_OR_VIEWER" のロール階層ゲートは全ルートが
 *   requirePermission / requireScopedPermission へ移行済みのため撤廃（§2-6a）。
 */
export async function requireAuth(
  req: NextRequest,
  _selfScope?: "DRIVER"
): Promise<AuthUser | NextResponse> {
  try {
    return await authProvider.verify(req.headers.get("authorization"));
  } catch (err) {
    console.log(`[Auth] Unauthorized:`, err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export function isAuthError(
  result: AuthUser | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
