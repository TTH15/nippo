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
 * 書き込みの認可には読み取り用の全件フォールバックを使わない。
 */
export async function orgOwnsCarrier(
  supabase: SupabaseClient,
  orgId: string,
  carrierId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("company_carriers")
    .select("carrier_id")
    .eq("org_id", orgId)
    .eq("carrier_id", carrierId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** 共有マスタの変更は、現在そのキャリアを使う会社が1社の間だけ許す。 */
export async function orgCanEditCarrier(supabase: SupabaseClient, orgId: string, carrierId: string): Promise<boolean> {
  const { data, error } = await supabase
    // tenant-scope-ok: 共有マスタを使う全会社の件数を確認し、1社だけのときに限り変更を許す
    .from("company_carriers")
    .select("org_id")
    .eq("carrier_id", carrierId)
    .limit(2);
  if (error) throw error;
  return data?.length === 1 && data[0].org_id === orgId;
}

/** unit_fields の変更前に、親 unit を通じて会社の有効化を確認する。 */
export async function orgOwnsUnit(supabase: SupabaseClient, orgId: string, unitId: string): Promise<boolean> {
  const { data, error } = await supabase.from("units").select("carrier_id").eq("id", unitId).maybeSingle();
  if (error) throw error;
  return !!data?.carrier_id && orgCanEditCarrier(supabase, orgId, data.carrier_id);
}

/** ID指定の報告フィールド変更では、親 unit まで辿って確認する。 */
export async function orgOwnsUnitField(supabase: SupabaseClient, orgId: string, fieldId: string): Promise<boolean> {
  const { data, error } = await supabase.from("unit_fields").select("unit_id").eq("id", fieldId).maybeSingle();
  if (error) throw error;
  return !!data?.unit_id && orgOwnsUnit(supabase, orgId, data.unit_id);
}
