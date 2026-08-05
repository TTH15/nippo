import type { AuthUser } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { signToken } from "@/server/auth/jwt";
import { resolveCapabilities } from "@/server/auth/permissions";
import { getCompany } from "@/config/companies";

// ログイン中ユーザーの identity_id を解決する。
// JWT（6a）に identity_id があればそれを使い、無ければ drivers から引く。
export async function resolveIdentityId(user: AuthUser): Promise<string | null> {
  if (user.identityId) return user.identityId;
  const { data } = await supabase.from("drivers").select("identity_id").eq("id", user.driverId).single();
  return (data?.identity_id as string | null | undefined) ?? null;
}

export type ActiveDriverRow = {
  id: string;
  name: string;
  role: string;
  company_code: string | null;
  office_code: string | null;
  driver_code: string | null;
  identity_id: string | null;
  org_id: string | null;
  status: string | null;
};

/**
 * identity（人）から、その人の有効な membership（drivers 行）を1件解決する。
 * Passkeyログイン・SMS OTPリカバリーなど「identityは分かるがdriverIdはまだ分からない」
 * ログイン経路で共用する。複数org所属の選択UIは未実装のため "multiple" はエラー扱い。
 */
/**
 * identity から membership を1件も解決できなかったときに、**理由の分かる**メッセージを返す。
 * 招待リンク経由の人は PIN を持たない（§2-1a）ため、ここで詰まると復旧手段が無くなる。
 * 「有効なアカウントが見つかりません」だけでは本人も運営も原因に辿り着けない（2026-08-05 指摘）。
 */
export async function describeIdentityLoginFailure(
  identityId: string,
  reason: "none" | "multiple",
): Promise<{ error: string; status: number }> {
  if (reason === "multiple") {
    return {
      error: "複数の所属があるため、この方法ではログインできません。運営にお問い合わせください",
      status: 409,
    };
  }
  const { data: memberships } = await supabase
    .from("drivers") // tenant-scope-ok: ログイン経路。org 文脈が確定する前の診断
    .select("status")
    .eq("identity_id", identityId);
  const statuses = new Set((memberships ?? []).map((m) => m.status as string | null));
  if (statuses.size === 0) {
    return { error: "有効なアカウントが見つかりませんでした", status: 401 };
  }
  if (statuses.has("pending")) {
    return { error: "アカウントは承認待ちです。運営の承認をお待ちください", status: 403 };
  }
  if (statuses.has("rejected")) {
    return { error: "この申請は承認されませんでした。運営にお問い合わせください", status: 403 };
  }
  return { error: "このアカウントは現在利用できません。運営にお問い合わせください", status: 403 };
}

export async function resolveActiveDriverByIdentity(
  identityId: string,
): Promise<{ driver: ActiveDriverRow } | { error: "none" | "multiple" }> {
  const { data: drivers, error } = await supabase
    .from("drivers") // tenant-scope-ok: ログイン経路（Passkey/SMS）。org 文脈が確定する前に identity から membership を引く
    .select("id, name, role, company_code, office_code, driver_code, identity_id, org_id, status")
    .eq("identity_id", identityId)
    .eq("status", "active");

  if (error || !drivers || drivers.length === 0) return { error: "none" };
  if (drivers.length > 1) return { error: "multiple" };
  return { driver: drivers[0] };
}

/** driver 行から通常ログインと同じ形の {token, driver} セッションを発行する。 */
export async function issueDriverSession(driver: ActiveDriverRow) {
  const envCompany = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

  const token = await signToken({
    driverId: driver.id,
    role: driver.role,
    companyCode: driver.company_code || envCompany.code,
    identityId: driver.identity_id,
    orgId: driver.org_id,
  });

  const capabilities = await resolveCapabilities(driver.id, driver.role);

  return {
    token,
    driver: {
      id: driver.id,
      name: driver.name,
      role: driver.role,
      companyCode: driver.company_code,
      officeCode: driver.office_code ?? "",
      driverCode: driver.driver_code ?? "",
      capabilities: Array.from(capabilities),
    },
  };
}
