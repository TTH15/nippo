import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";
import type { AuthUser } from "./types";

/** セッションだけでは別の電話を登録できない。運営が保存した番号へのSMS確認に限定。 */
export async function phoneEnrollment(user: AuthUser, identityId: string) {
  const [{ data: identity, error }, { data: driver, error: driverError }] = await Promise.all([
    supabase.from("identities").select("phone, phone_verified_at").eq("id", identityId).maybeSingle(),
    supabase.from("drivers").select("phone").eq("id", user.driverId).eq("org_id", user.orgId).eq("identity_id", identityId).maybeSingle(),
  ]);
  if (error || driverError || !identity || !driver) throw new Error("登録済みの電話番号を確認できませんでした");
  return { identity, phone: toE164JP(identity.phone || driver.phone || "") };
}
