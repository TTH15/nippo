import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import type { AuthUser } from "./types";

export const RECENT_AUTH_SECONDS = 5 * 60;
const now = () => Math.floor(Date.now() / 1000);
const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(process.env.JWT_SECRET);
};

export const freshStrongAuth = (method: "sms" | "passkey") => ({ strongAuthAt: now(), strongAuthMethod: method });
export const sessionFingerprint = (req: NextRequest) => createHash("sha256").update(req.headers.get("authorization") ?? "").digest("hex");

export function hasRecentStrongAuth(user: AuthUser): boolean {
  const age = now() - (user.strongAuthAt ?? 0);
  return !!user.identityId && (user.strongAuthMethod === "sms" || user.strongAuthMethod === "passkey") &&
    Number.isSafeInteger(user.strongAuthAt) && age >= 0 && age < RECENT_AUTH_SECONDS;
}

export async function issueRecentAuthGrant(req: NextRequest, user: AuthUser): Promise<string> {
  if (!user.identityId || !req.headers.get("authorization")) throw new Error("Missing authenticated identity");
  return new SignJWT({ kind: "passkey_management", identity_id: user.identityId, driver_id: user.driverId,
    org_id: user.orgId, token_version: user.tokenVersion ?? 0, session_hash: sessionFingerprint(req) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${RECENT_AUTH_SECONDS}s`).sign(secret());
}

export async function hasRecentAuth(req: NextRequest, user: AuthUser): Promise<boolean> {
  if (hasRecentStrongAuth(user)) return true;
  const grant = req.headers.get("x-reauth-token");
  if (!grant || !user.identityId) return false;
  try {
    const { payload } = await jwtVerify(grant, secret(), { algorithms: ["HS256"] });
    return payload.kind === "passkey_management" && payload.identity_id === user.identityId &&
      payload.driver_id === user.driverId && payload.org_id === user.orgId &&
      payload.token_version === (user.tokenVersion ?? 0) && payload.session_hash === sessionFingerprint(req) &&
      typeof payload.iat === "number" && payload.iat <= now() && now() - payload.iat < RECENT_AUTH_SECONDS;
  } catch { return false; }
}

export async function requireRecentAuth(req: NextRequest, user: AuthUser): Promise<NextResponse | null> {
  return await hasRecentAuth(req, user) ? null : NextResponse.json({
    error: "Passkeyを変更する前に、もう一度本人確認をしてください", code: "RECENT_AUTH_REQUIRED",
  }, { status: 403 });
}
