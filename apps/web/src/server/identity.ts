import type { AuthUser } from "@/server/auth";
import { supabase } from "@/server/db/client";

// ログイン中ユーザーの identity_id を解決する。
// JWT（6a）に identity_id があればそれを使い、無ければ drivers から引く。
export async function resolveIdentityId(user: AuthUser): Promise<string | null> {
  if (user.identityId) return user.identityId;
  const { data } = await supabase.from("drivers").select("identity_id").eq("id", user.driverId).single();
  return (data?.identity_id as string | null | undefined) ?? null;
}
