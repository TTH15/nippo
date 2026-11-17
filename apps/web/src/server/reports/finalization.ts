import { supabase } from "@/server/db/client";
import { buildFinalizationSnapshots, type FinalizationSource } from "@/server/aggregation/rateSnapshot";

/** 承認からは呼ばない。午前3時のジョブと、再承認済み修正の終了だけで固定する。 */
export async function finalizeReportDay(orgId: string, driverId: string, date: string): Promise<number> {
  const { data, error } = await supabase.rpc("report_finalization_source", { p_org: orgId, p_driver: driverId, p_date: date });
  if (error) throw error;
  if (!data?.reports?.length) return 0;
  const snapshots = buildFinalizationSnapshots(data as FinalizationSource);
  const result = await supabase.rpc("finalize_report_day", {
    p_org: orgId, p_driver: driverId, p_date: date, p_expected: data, p_snapshots: snapshots,
  });
  if (result.error) throw result.error;
  return Number(result.data) || 0;
}
