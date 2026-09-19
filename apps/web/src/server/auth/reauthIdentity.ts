import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";

export async function reauthIdentity(identityId: string) {
  const [{ data: identity, error }, { count, error: keyError }] = await Promise.all([
    supabase.from("identities").select("phone, phone_verified_at").eq("id", identityId).maybeSingle(),
    supabase.from("passkey_credentials").select("id", { count: "exact", head: true }).eq("identity_id", identityId),
  ]);
  if (error || keyError || !identity) throw new Error("本人確認の設定を読み込めませんでした");
  const phone = identity.phone_verified_at ? toE164JP(identity.phone ?? "") : null;
  return { phone, phoneMasked: phone ? `下4桁 ${phone.slice(-4)}` : null, hasPasskey: (count ?? 0) > 0 };
}
