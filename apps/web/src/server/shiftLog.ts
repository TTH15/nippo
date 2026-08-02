import { supabase } from "@/server/db/client";

// 配車・シフト割当の変更ログ（migration 121）。将来の AI（配車提案・制約学習）用の
// 追記専用データで、書き込みはベストエフォート — 失敗しても呼び出し元の処理は成功させる。
// 呼び出しは await せず `void logShiftChange({...})` で投げっぱなしにしてよい。
export async function logShiftChange(entry: {
  orgId: string | null | undefined;
  actorDriverId: string;
  action: "assign_driver" | "clear_driver" | "assign_vehicle" | "loan_on" | "loan_off" | "import_apply";
  shiftDate?: string | null;
  courseId?: string | null;
  slot?: number | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    const { error } = await supabase.from("shift_change_logs").insert({
      org_id: entry.orgId ?? null,
      actor_driver_id: entry.actorDriverId,
      action: entry.action,
      shift_date: entry.shiftDate ?? null,
      course_id: entry.courseId ?? null,
      slot: entry.slot ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
    if (error) console.error("[shiftLog] insert error", error);
  } catch (e) {
    console.error("[shiftLog] error", e);
  }
}
