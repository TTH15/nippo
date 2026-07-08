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
export async function resolveActiveDriverByIdentity(
  identityId: string,
): Promise<{ driver: ActiveDriverRow } | { error: "none" | "multiple" }> {
  const { data: drivers, error } = await supabase
    .from("drivers")
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
