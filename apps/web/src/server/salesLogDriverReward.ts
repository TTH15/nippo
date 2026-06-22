import type { SupabaseClient } from "@supabase/supabase-js";

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

  const { error } = await supabase.from("driver_ad_hoc_expenses").insert({
    driver_id: entry.target_driver_id!,
    month: month!,
    name: nameFinal,
    amount,
    sales_log_entry_id: entry.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
