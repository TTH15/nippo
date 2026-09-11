import type { SupabaseClient } from "@supabase/supabase-js";

type ReportVehicle = {
  id: string; owner_org_id: string; current_mileage: number | null;
  number_prefix: string | null; number_class: string | null;
  number_hiragana: string | null; number_numeric: string | null;
};

/** 報告日の所有車・正式な貸与車だけを取得する。更新時にも取得した所有会社を条件にする。 */
export async function loadReportVehicles(db: SupabaseClient, orgId: string, ids: string[], reportDate: string): Promise<ReportVehicle[]> {
  if (!ids.length) return [];
  const columns = "id, owner_org_id, current_mileage, number_prefix, number_class, number_hiragana, number_numeric";
  const { data: owned, error } = await db.from("vehicles").select(columns).eq("owner_org_id", orgId).in("id", ids);
  if (error) throw error;
  const remaining = ids.filter(id => !owned?.some(v => v.id === id));
  if (!remaining.length) return owned ?? [];
  const { data: loans, error: loanError } = await db.from("vehicle_loans").select("vehicle_id")
    .eq("borrower_org_id", orgId).eq("loan_date", reportDate).in("vehicle_id", remaining);
  if (loanError) throw loanError;
  const loanIds = [...new Set((loans ?? []).map(loan => loan.vehicle_id))];
  if (!loanIds.length) return owned ?? [];
  // tenant-scope-ok: loanIds は借用会社orgId・報告日のvehicle_loansで認可済み。所有会社も更新条件に返す
  const { data: borrowed, error: vehicleError } = await db.from("vehicles").select(columns).in("id", loanIds);
  if (vehicleError) throw vehicleError;
  return [...(owned ?? []), ...(borrowed ?? [])];
}
