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
  OWN_PERMISSIONS,
  type Capability,
  type OwnPermission,
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
    // DRIVERが要求された場合、ADMINもアクセス可能
    if (
      requiredRole === "DRIVER" &&
      user.role !== "DRIVER" &&
      user.role !== "ADMIN" &&
      user.role !== "ADMIN_VIEWER"
    ) {
      console.log(`[Auth] Forbidden: required DRIVER, got ${user.role}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
