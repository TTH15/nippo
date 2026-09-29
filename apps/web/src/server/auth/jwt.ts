import { jwtVerify, SignJWT } from "jose";
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
}): Promise<string> {
  const purpose = payload.purpose ?? "work";
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
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(`hakotora-${purpose}`)
    .setIssuedAt()
    .setExpirationTime(purpose === "admin" ? "8h" : "30d")
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

    // role は表示ラベル（カスタムロールのキーも入りうる）。権限の判定は capability 側で行うため、
    // ここでは driverId と非空 role の存在のみ検証する。
    if (!driverId || typeof role !== "string" || !role ||
        typeof tokenVersion !== "number" || !Number.isSafeInteger(tokenVersion) || tokenVersion < 0 ||
        (purpose !== "work" && purpose !== "admin") ||
        (payload.purpose !== undefined && payload.aud !== `hakotora-${purpose}`) ||
        (purpose === "admin" && (!orgId || !identityId))) {
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
