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

/**
 * 当 org がそのキャリアを管理してよいか（company_carriers に有効化があるか）。
 * 未設定（loadOrgCarrierIds が null）の org は許可（読みのフォールバックと同じ＝087未適用でも壊さない）。
 */
export async function orgOwnsCarrier(
  supabase: SupabaseClient,
  orgId: string,
  carrierId: string,
): Promise<boolean> {
  const ids = await loadOrgCarrierIds(supabase, orgId);
  return ids === null || ids.includes(carrierId);
}
