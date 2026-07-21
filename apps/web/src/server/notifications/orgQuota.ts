// ============================================================
// org 別 LINE 通数の集計（roadmap-2026-07 E④ の土台）。
// 複数 org 運用に向けて、LINE 実 API 値（チャネル全体）ではなく
// org ごとの上限＋自前カウントで残数を出せるようにする。
//
// 今は「表示」まで。上限超での送信ブロックは複数 org が現実になる段階で足す
// （その際は dispatch / chat POST の手前で remaining を見て弾く）。
// ============================================================
import { supabase } from "@/server/db/client";
import { computeRemaining, jstMonthStartIso } from "@/server/notifications/quotaMath";

export type OrgQuota = {
  /** org の月上限（通）。未設定なら null＝上限なし。 */
  limit: number | null;
  /** 今月このorg が送った LINE 通数（notification_deliveries から集計）。 */
  used: number;
  /** 残り。上限なしなら null。 */
  remaining: number | null;
};

/**
 * org の今月の LINE 通数を集計する。
 * notification_deliveries を org の通知に結合して channel='line' & status='sent' を数える。
 */
export async function getOrgLineQuota(orgId: string): Promise<OrgQuota> {
  const { data: settings } = await supabase
    .from("org_notification_settings")
    .select("line_monthly_limit")
    .eq("org_id", orgId)
    .maybeSingle();
  const limit = (settings?.line_monthly_limit as number | null) ?? null;

  // notifications(org_id) → notification_deliveries(line, sent) を今月分だけ数える。
  // 内部結合を select の入れ子で表現し、org と期間で絞る。
  const since = jstMonthStartIso(new Date());
  const { count } = await supabase
    .from("notification_deliveries")
    .select("id, notifications!inner(org_id)", { count: "exact", head: true })
    .eq("channel", "line")
    .eq("status", "sent")
    .eq("notifications.org_id", orgId)
    .gte("sent_at", since);

  const used = count ?? 0;
  return { limit, used, remaining: computeRemaining(limit, used) };
}
