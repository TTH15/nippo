// 希望休の変更ログ（shift_request_logs）への記録ヘルパー。
//   ログ失敗は本処理を妨げない best-effort（記録漏れより本機能の継続を優先）。
import { supabase } from "@/server/db/client";

export type ShiftLogRow = {
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
  const { error } = await supabase.from("shift_request_logs").insert(rows);
  if (error) console.error("[shift_request_logs] insert error", error);
}

/** drivers から表示名スナップショット（display_name 優先・無ければ name）を取得。 */
export async function fetchActorName(driverId: string): Promise<string | null> {
  const { data } = await supabase
    .from("drivers")
    .select("name, display_name")
    .eq("id", driverId)
    .maybeSingle();
  if (!data) return null;
  return (data.display_name as string | null) || (data.name as string | null) || null;
}
