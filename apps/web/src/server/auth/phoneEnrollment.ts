import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";
import type { AuthUser } from "./types";

/** 保存済み番号は変更しない。番号が両方とも空の本人だけ初回登録を認める。 */
export async function phoneEnrollment(user: AuthUser, identityId: string) {
  const [{ data: identity, error }, { data: driver, error: driverError }] = await Promise.all([
    supabase.from("identities").select("phone, phone_verified_at").eq("id", identityId).maybeSingle(),
    supabase.from("drivers").select("phone").eq("id", user.driverId).eq("org_id", user.orgId).eq("identity_id", identityId).maybeSingle(),
  ]);
  if (error || driverError || !identity || !driver) throw new Error("登録済みの電話番号を確認できませんでした");
  return { identity, phone: toE164JP(identity.phone || driver.phone || ""), canRegister: !String(identity.phone ?? "").trim() && !String(driver.phone ?? "").trim() };
}
