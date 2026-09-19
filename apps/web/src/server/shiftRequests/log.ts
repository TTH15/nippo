// 希望休の変更ログ（shift_request_logs）への記録ヘルパー。
//   ログ失敗は本処理を妨げない best-effort（記録漏れより本機能の継続を優先）。
import { supabase } from "@/server/db/client";
import { isMissingOrgColumn, withoutOrgId } from "@/server/db/orgColumn";

export type ShiftLogRow = {
  // 対象ドライバーの所属。型で必須にして、呼び出し側の入れ忘れを型検査で止める。
  org_id: string;
  driver_id: string;
  request_date: string;
  slot_id: string | null;
  slot_name: string | null;
  action: "add" | "remove";
  actor_type: "driver" | "admin";
  actor_id: string;
  actor_name: string | null;
};

export async function insertShiftRequestLogs(rows: ShiftLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  // tenant-scope-ok: ShiftLogRow が org_id 必須。呼び出し側が対象ドライバーの所属を入れている
  let error = (await supabase.from("shift_request_logs").insert(rows)).error;
  if (isMissingOrgColumn(error)) {
    // tenant-scope-ok: 同じ行の退避。migration 174 未適用（org_id 列が無い）環境でのみ通る
    error = (await supabase.from("shift_request_logs").insert(withoutOrgId(rows))).error;
  }
  if (error) console.error("[shift_request_logs] insert error", error);
}

/** drivers から表示名スナップショット（display_name 優先・無ければ name）を取得。 */
export async function fetchActorName(driverId: string): Promise<string | null> {
  const { data } = await supabase
    // tenant-scope-ok: 2つの呼び出し元とも認証済みuser.driverId。ログ用の本人表示名だけを取得
    .from("drivers")
    .select("name, display_name")
    .eq("id", driverId)
    .maybeSingle();
  if (!data) return null;
  return (data.display_name as string | null) || (data.name as string | null) || null;
}
