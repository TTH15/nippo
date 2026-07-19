import { NextRequest, NextResponse } from "next/server";
import { authProvider } from "./jwt";
import type { AuthUser } from "./types";

export type { AuthUser, MembershipRole } from "./types";
export { authProvider, signToken } from "./jwt";
export { requirePermission, hasCapability, getCapabilities, resolveCapabilities } from "./permissions";
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
 * Helper: extract AuthUser from request, or return 401 response.
 */
export async function requireAuth(
  req: NextRequest,
  requiredRole?: "DRIVER" | "ADMIN" | "ADMIN_OR_VIEWER"
): Promise<AuthUser | NextResponse> {
  try {
    const user = await authProvider.verify(
      req.headers.get("authorization")
    );
    // ADMINはフル権限のみ
    if (requiredRole === "ADMIN" && user.role !== "ADMIN") {
      console.log(`[Auth] Forbidden: required ADMIN, got ${user.role}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // ADMIN_OR_VIEWER は ADMIN / ADMIN_VIEWER 両方OK
    if (
      requiredRole === "ADMIN_OR_VIEWER" &&
      user.role !== "ADMIN" &&
      user.role !== "ADMIN_VIEWER"
    ) {
      console.log(
        `[Auth] Forbidden: required ADMIN_OR_VIEWER, got ${user.role}`,
      );
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // 「DRIVER」要求 = ドライバー本人系のセルフスコープルート（/api/me/* 等）。
    // 対象は常にトークンの driverId 自身なので、ロールでは絞らない。
    // 旧実装は DRIVER/ADMIN/ADMIN_VIEWER のホワイトリストで、ACCOUNTING や
    // カスタムロール（CUSTOM_*）のメンバーが自分のプロフィール・日報・Passkey 状態
    // まで 403 になっていた（§2-6a）。細粒度化は own スコープ移行で段階対応する
    // （シフト系は requireScopedPermission へ移行済み）。
    return user;
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
