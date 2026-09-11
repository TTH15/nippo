import { supabase } from "@/server/db/client";
import type { AuthUser } from "./types";

// 本人登録だけを継続できるよう、パスの前方一致にはしない。
const PENDING_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/me/registration": ["GET", "POST"],
  "/api/me/registration/photo": ["POST"],
  "/api/reports/profile": ["GET", "POST"],
  "/api/auth/webauthn/register/options": ["POST"],
  "/api/auth/webauthn/register/verify": ["POST"],
};

type MembershipResult = { user: AuthUser } | { status: 401 | 403 | 503; error: string };

export async function checkMembership(
  user: AuthUser,
  request: { pathname: string; method: string },
): Promise<MembershipResult> {
  const { data: driver, error } = await supabase
    .from("drivers")
    .select("status, role, company_code, org_id, identity_id, token_version")
    .eq("id", user.driverId)
    .maybeSingle();
  if (error) return { status: 503, error: "利用状況を確認できませんでした。時間をおいてもう一度お試しください" };
  if (!driver || (driver.status !== "active" && driver.status !== "pending")) {
    return { status: 401, error: "このアカウントは現在利用できません。運営にお問い合わせください" };
  }
  if (!Number.isSafeInteger(driver.token_version) || driver.token_version !== (user.tokenVersion ?? 0) ||
      (user.orgId !== null && user.orgId !== driver.org_id) ||
      (user.identityId !== null && user.identityId !== driver.identity_id)) {
    return { status: 401, error: "ログインし直してください" };
  }
  if ((driver.status === "pending" || driver.role === "PENDING") &&
      !PENDING_ROUTES[request.pathname]?.includes(request.method)) {
    return { status: 403, error: "アカウントは承認待ちです。運営の承認をお待ちください" };
  }
  return { user: {
    ...user,
    role: driver.role,
    companyCode: driver.company_code ?? user.companyCode,
    orgId: driver.org_id,
    identityId: driver.identity_id,
    tokenVersion: driver.token_version,
  } };
}
