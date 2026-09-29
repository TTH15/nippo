import { jwtVerify, SignJWT } from "jose";
import { NextResponse, type NextRequest } from "next/server";

export const ADMIN_RENEW_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-nippo_admin_renew" : "nippo_admin_renew";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type AdminRenewClaims = {
  driverId: string;
  identityId: string;
  orgId: string;
  tokenVersion: number;
};

function secret() {
  if (!process.env.JWT_SECRET) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function signAdminRenew(claims: AdminRenewClaims): Promise<string> {
  return new SignJWT({
    identity_id: claims.identityId,
    org_id: claims.orgId,
    token_version: claims.tokenVersion,
    purpose: "admin_renew",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.driverId)
    .setAudience("hakotora-admin-renew")
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyAdminRenew(req: NextRequest): Promise<AdminRenewClaims | null> {
  const token = req.cookies.get(ADMIN_RENEW_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"], audience: "hakotora-admin-renew",
    });
    if (payload.purpose !== "admin_renew" || !payload.sub ||
        typeof payload.identity_id !== "string" || !payload.identity_id ||
        typeof payload.org_id !== "string" || !payload.org_id ||
        typeof payload.token_version !== "number" ||
        !Number.isSafeInteger(payload.token_version) || payload.token_version < 0) return null;
    return {
      driverId: payload.sub,
      identityId: payload.identity_id,
      orgId: payload.org_id,
      tokenVersion: payload.token_version,
    };
  } catch { return null; }
}

export function setAdminRenewCookie(response: NextResponse, token: string): void {
  response.cookies.set(ADMIN_RENEW_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/", maxAge: MAX_AGE_SECONDS,
  });
}

export function clearAdminRenewCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_RENEW_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/", maxAge: 0,
  });
}
