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
}): Promise<string> {
  return new SignJWT({ 
    sub: payload.driverId, 
    role: payload.role,
    companyCode: payload.companyCode,
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
    
    if (!driverId || !["DRIVER", "ADMIN", "ADMIN_VIEWER"].includes(role)) {
      throw new Error("Invalid token payload");
    }
    return { 
      driverId, 
      role: role as AuthUser["role"],
      companyCode: companyCode || "AAA", // 後方互換性
    };
  }
}

// -------------------------------------------------------
// Singleton (swap this line to switch providers)
// -------------------------------------------------------
export const authProvider = new SimpleJwtAuthProvider();
