import { jwtVerify, SignJWT } from "jose";
import { createHash, randomUUID } from "node:crypto";
import type { AuthProvider, AuthUser, MembershipRole } from "./types";

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
  role: MembershipRole;
  companyCode: string;
  // Phase 6a: identity（人）と current_org_id（選択中の所属）を運ぶ。未指定（旧呼び出し）は null。
  identityId?: string | null;
  orgId?: string | null;
  tokenVersion?: number;
  strongAuthAt?: number;
  strongAuthMethod?: "sms" | "passkey";
  purpose?: "work" | "admin";
  sessionId?: string;
  sessionExpiresAt?: number;
  parentSessionId?: string;
}): Promise<string> {
  const purpose = payload.purpose ?? "work";
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(payload.sessionExpiresAt ?? Infinity, now + (purpose === "admin" ? 15 * 60 : 30 * 86400));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new Error("Session expired");
  if (purpose === "admin" && (!payload.orgId || !payload.identityId)) {
    throw new Error("Admin session requires organization and identity");
  }
  return new SignJWT({
    sub: payload.driverId,
    role: payload.role,
    companyCode: payload.companyCode,
    identity_id: payload.identityId ?? null,
    current_org_id: payload.orgId ?? null,
    token_version: payload.tokenVersion ?? 0,
    strong_auth_at: payload.strongAuthAt,
    strong_auth_method: payload.strongAuthMethod,
    purpose,
    session_expires_at: expiresAt,
    parent_session_id: payload.parentSessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(`hakotora-${purpose}`)
    .setJti(payload.sessionId ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)
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
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });

    const driverId = payload.sub;
    const role = payload.role as string;
    const companyCode = payload.companyCode as string;
    // Phase 6a: 旧トークンには無いため null フォールバック（後方互換）。
    const identityId = (payload.identity_id as string | null | undefined) ?? null;
    const orgId = (payload.current_org_id as string | null | undefined) ?? null;
    const tokenVersion = payload.token_version ?? 0;
    const purpose = payload.purpose ?? "work";
    const sessionId = payload.jti ?? createHash("sha256").update(token).digest("hex");
    const sessionExpiresAt = payload.session_expires_at ?? payload.exp;
    const parentSessionId = payload.parent_session_id;

    // role は表示ラベル（カスタムロールのキーも入りうる）。権限の判定は capability 側で行うため、
    // ここでは driverId と非空 role の存在のみ検証する。
    if (!driverId || typeof role !== "string" || !role ||
        typeof tokenVersion !== "number" || !Number.isSafeInteger(tokenVersion) || tokenVersion < 0 ||
        (purpose !== "work" && purpose !== "admin") ||
        (payload.purpose !== undefined && payload.aud !== `hakotora-${purpose}`) ||
        (purpose === "admin" && (!orgId || !identityId)) ||
        typeof sessionId !== "string" || !/^(?:[0-9a-f-]{36}|[0-9a-f]{64})$/i.test(sessionId) ||
        typeof sessionExpiresAt !== "number" || !Number.isSafeInteger(sessionExpiresAt) || sessionExpiresAt <= Math.floor(Date.now() / 1000) ||
        (parentSessionId !== undefined && (typeof parentSessionId !== "string" || !/^(?:[0-9a-f-]{36}|[0-9a-f]{64})$/i.test(parentSessionId)))) {
      throw new Error("Invalid token payload");
    }
    return {
      driverId,
      role: role as AuthUser["role"],
      companyCode: companyCode || "AAA", // 後方互換性
      identityId,
      orgId,
      tokenVersion,
      purpose,
      sessionId,
      sessionExpiresAt,
      ...(typeof parentSessionId === "string" ? { parentSessionId } : {}),
      ...(typeof payload.strong_auth_at === "number" && Number.isSafeInteger(payload.strong_auth_at) &&
        (payload.strong_auth_method === "sms" || payload.strong_auth_method === "passkey")
        ? { strongAuthAt: payload.strong_auth_at, strongAuthMethod: payload.strong_auth_method } : {}),
    };
  }
}

// -------------------------------------------------------
// Singleton (swap this line to switch providers)
// -------------------------------------------------------
export const authProvider = new SimpleJwtAuthProvider();
