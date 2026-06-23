import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 当 org が有効化したキャリアID一覧（company_carriers）。
 * 行が無い（未設定／087未適用）場合は null を返し、呼び出し側は全キャリアに
 * フォールバックする（移行期に既存挙動を壊さないため）。onboarding で明示設定する想定。
 */
export async function loadOrgCarrierIds(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string[] | null> {
  const { data } = await supabase
    .from("company_carriers")
    .select("carrier_id")
    .eq("org_id", orgId);
  const ids = (data ?? []).map((r: { carrier_id: string }) => r.carrier_id);
  return ids.length > 0 ? ids : null;
}
