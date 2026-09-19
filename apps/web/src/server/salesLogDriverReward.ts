import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingOrgColumn, withoutOrgId } from "@/server/db/orgColumn";

export type SalesLogEntryForReward = {
  id: string;
  log_date: string;
  revenue: number;
  profit: number;
  target_driver_id: string | null;
  content: string;
};

/**
 * 売上ログの「売上 − 利益」をドライバー報酬として反映する。
 * ペイメントの臨時経費「＋」（手当）と同じく amount は負の値で保存する。
 */
export async function syncSalesLogDriverReward(
  supabase: SupabaseClient,
  orgId: string,
  entry: SalesLogEntryForReward,
): Promise<void> {
  const revenue = Math.max(0, Math.trunc(Number(entry.revenue) || 0));
  const profit = Math.trunc(Number(entry.profit) || 0);
  const reward = Math.trunc(revenue - profit);

  const logDate = String(entry.log_date ?? "").slice(0, 10);
  const month =
    /^\d{4}-\d{2}-\d{2}$/.test(logDate) ? logDate.slice(0, 7) : null;

  const { data: existing } = await supabase
    // tenant-scope-ok: sales_log_entry_id は呼び出し元が org で絞って読んだ売上ログの id
    .from("driver_ad_hoc_expenses")
    .select("id")
    .eq("sales_log_entry_id", entry.id)
    .maybeSingle();

  const existingId = existing?.id as string | undefined;

  const shouldPay =
    !!entry.target_driver_id && reward > 0 && !!month;

  if (!shouldPay) {
    if (existingId) {
      const { error } = await supabase
        // tenant-scope-ok: existingId は直上の sales_log_entry_id 検索で得た1行
        .from("driver_ad_hoc_expenses")
        .delete()
        .eq("id", existingId);
      if (error) throw error;
    }
    return;
  }

  const { data: driverRow, error: driverErr } = await supabase
    .from("drivers")
    .select("id")
    .eq("id", entry.target_driver_id!)
    .eq("org_id", orgId)
    .maybeSingle();

  if (driverErr) throw driverErr;

  if (!driverRow) {
    if (existingId) {
      const { error } = await supabase
        // tenant-scope-ok: existingId は直上の sales_log_entry_id 検索で得た1行
        .from("driver_ad_hoc_expenses")
        .delete()
        .eq("id", existingId);
      if (error) throw error;
    }
    return;
  }

  const contentBit = entry.content.trim()
    ? `：${entry.content.trim().slice(0, 40)}`
    : "";
  const name = `単発案件報酬（売上ログ）${contentBit}`;
  const nameFinal = name.length > 200 ? name.slice(0, 200) : name;
  const amount = -reward;

  if (existingId) {
    const { error } = await supabase
      // tenant-scope-ok: existingId は sales_log_entry_id 検索で得た1行。driver も org 確認済み
      //   （org_id は既存行の値のまま。migration 176 の backfill と insert 側で埋まる）
      .from("driver_ad_hoc_expenses")
      .update({
        driver_id: entry.target_driver_id!,
        month: month!,
        name: nameFinal,
        amount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingId);
    if (error) throw error;
    return;
  }

  const row = {
    org_id: orgId,
    driver_id: entry.target_driver_id!,
    month: month!,
    name: nameFinal,
    amount,
    sales_log_entry_id: entry.id,
    updated_at: new Date().toISOString(),
  };
  // tenant-scope-ok: row に org_id: orgId（直上で所属を確認した driver と同じ org）を入れている
  let { error } = await supabase.from("driver_ad_hoc_expenses").insert(row);
  if (isMissingOrgColumn(error)) {
    // tenant-scope-ok: 同じ行の退避。migration 176 未適用（org_id 列が無い）環境でのみ通る
    ({ error } = await supabase.from("driver_ad_hoc_expenses").insert(withoutOrgId([row])[0]));
  }
  if (error) throw error;
}
