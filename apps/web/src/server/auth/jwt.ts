import { jwtVerify, SignJWT } from "jose";
import type { AuthProvider, AuthUser } from "./types";

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
};

// -------------------------------------------------------
// JWT helpers
// -------------------------------------------------------

export async function signToken(payload: {
  driverId: string;
  role: "DRIVER" | "ADMIN" | "ADMIN_VIEWER";
  companyCode: string;
  // Phase 6a: identity（人）と current_org_id（選択中の所属）を運ぶ。未指定（旧呼び出し）は null。
  identityId?: string | null;
  orgId?: string | null;
}): Promise<string> {
  return new SignJWT({
    sub: payload.driverId,
    role: payload.role,
    companyCode: payload.companyCode,
    identity_id: payload.identityId ?? null,
    current_org_id: payload.orgId ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

// -------------------------------------------------------
// AuthProvider implementation
// -------------------------------------------------------

export class SimpleJwtAuthProvider implements AuthProvider {
  async verify(authHeader: string | null): Promise<AuthUser> {
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Missing or invalid Authorization header");
    }
    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(token, secret());

    const driverId = payload.sub;
    const role = payload.role as string;
    const companyCode = payload.companyCode as string;
    // Phase 6a: 旧トークンには無いため null フォールバック（後方互換）。
    const identityId = (payload.identity_id as string | null | undefined) ?? null;
    const orgId = (payload.current_org_id as string | null | undefined) ?? null;

    if (!driverId || !["DRIVER", "ADMIN", "ADMIN_VIEWER"].includes(role)) {
      throw new Error("Invalid token payload");
    }
    return {
      driverId,
      role: role as AuthUser["role"],
      companyCode: companyCode || "AAA", // 後方互換性
      identityId,
      orgId,
    };
  }
}

// -------------------------------------------------------
// Singleton (swap this line to switch providers)
// -------------------------------------------------------
export const authProvider = new SimpleJwtAuthProvider();
