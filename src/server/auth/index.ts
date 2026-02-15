import { NextRequest, NextResponse } from "next/server";
import { authProvider } from "./jwt";
import type { AuthUser } from "./types";

export type { AuthUser } from "./types";
export { authProvider, signToken } from "./jwt";

/**
 * Helper: extract AuthUser from request, or return 401 response.
 */
export async function requireAuth(
  req: NextRequest,
  requiredRole?: "DRIVER" | "ADMIN"
): Promise<AuthUser | NextResponse> {
  try {
    const user = await authProvider.verify(
      req.headers.get("authorization")
    );
    // ADMINは全てのリソースにアクセス可能
    if (requiredRole === "ADMIN" && user.role !== "ADMIN") {
      console.log(`[Auth] Forbidden: required ADMIN, got ${user.role}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // DRIVERが要求された場合、ADMINもアクセス可能
    if (requiredRole === "DRIVER" && user.role !== "DRIVER" && user.role !== "ADMIN") {
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
