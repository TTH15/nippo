// ============================================================
// 「その通知は本人に届いたのか」を配信ログから読む（純粋ロジック）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-2
//
// ★通知を作ったこと＝伝わったこと ではない。
//   インボックスには必ず入るが、本人が見に来るとは限らない。LINE 未連携・
//   Web Push の端末なし・送信失敗は、どれも「外向きの経路では届いていない」。
//   ここではその3つを区別し、運営が代替連絡を取れるようにする。
//   既読（notifications.read_at）とも、予定への同意（shift_plan_confirmations）とも別。
// ============================================================

export type DeliveryRow = {
  notificationId: string;
  channel: string;
  status: string;
  error: string | null;
};

/** unlinked=未連携 / no_subscription=端末なし / not_configured=会社で未設定 / failed=送信失敗 */
export type UnreachedReason = "unlinked" | "no_subscription" | "not_configured" | "failed" | "no_attempt";

export type DeliverySummary = {
  notificationId: string;
  /** 外向きのどれか1つでも送れたか */
  reached: boolean;
  /** 届かなかった理由（重い順に1つ）。reached なら null */
  reason: UnreachedReason | null;
  channels: { channel: string; status: string; error: string | null }[];
};

// 運営が取るべき行動が違うので、重い順に1つだけ出す。
// failed（起きてはいけない）> unlinked（本人に連携してもらう）
// > no_subscription（端末の許可）> not_configured（会社の設定）
const REASON_ORDER: UnreachedReason[] = ["failed", "unlinked", "no_subscription", "not_configured", "no_attempt"];

function reasonOf(row: { status: string; error: string | null }): UnreachedReason | null {
  if (row.status === "sent") return null;
  if (row.status === "failed") return "failed";
  if (row.error === "unlinked") return "unlinked";
  if (row.error === "no_subscription") return "no_subscription";
  if (row.error === "not_configured") return "not_configured";
  return "no_attempt";
}

/**
 * 通知ごとに配信ログをまとめる。
 * 配信ログが1行も無い通知（＝外向きに一度も試していない）も「届いていない」に含める。
 */
export function summarizeDeliveries(
  notificationIds: readonly string[],
  rows: readonly DeliveryRow[],
): DeliverySummary[] {
  const byNotification = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    const list = byNotification.get(row.notificationId);
    if (list) list.push(row);
    else byNotification.set(row.notificationId, [row]);
  }

  return notificationIds.map((notificationId) => {
    const logs = byNotification.get(notificationId) ?? [];
    const reached = logs.some((row) => row.status === "sent");
    const channels = logs.map((row) => ({ channel: row.channel, status: row.status, error: row.error }));
    if (reached) return { notificationId, reached: true, reason: null, channels };
    const reasons = logs.map(reasonOf).filter((r): r is UnreachedReason => r != null);
    const reason = REASON_ORDER.find((candidate) => reasons.includes(candidate)) ?? "no_attempt";
    return { notificationId, reached: false, reason, channels };
  });
}

/**
 * 再送して意味があるか。
 *
 * ★`no_attempt`（配信ログが1行も無い）は**再送しない**。
 *   この機能を入れる前の通知にはログが無く、実際には LINE で届いているものが多い。
 *   それを「送っていない」と見なして一括再送すると、**過去2週間ぶんの古い通知が
 *   ドライバーの端末へ連打される**（外部送信なので取り消せない）。
 *   記録が無いことは「届いていない証拠」ではないので、運営が個別に判断する。
 * 経路が無いもの（未連携・端末なし・未設定）も、何度送っても届かないので対象外。
 */
export function isResendable(reason: UnreachedReason | null): boolean {
  return reason === "failed";
}
