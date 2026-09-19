import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { deliverStoredNotifications } from "@/server/notifications/dispatch";
import { isResendable, summarizeDeliveries, type DeliveryRow } from "@/server/notifications/delivery";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

export const dynamic = "force-dynamic";

// ============================================================
// 本人へ届いていない通知の一覧と再送。
// 設計: docs/design/operational-risk-detection-2026-09.md O-2
//
// ★通知を作ったこと＝伝わったこと ではない。インボックスには必ず入るが、
//   LINE 未連携・端末なし・送信失敗は外向きの経路では届いていない。
//   運営が代替連絡（電話など）を取れるよう、理由つきで見えるようにする。
//
// 再送して意味があるのは「送信失敗」だけ。未連携・端末なしは何度送っても届かず、
// 「記録なし」はこの機能より前の通知（実際は届いている）なので再送の対象にしない。
// ============================================================

/** 何日ぶんさかのぼるか。古い通知の再送は混乱のもとなので短くとる */
const LOOKBACK_DAYS = 14;
/** 直近から見る件数。ここで切れた場合は truncated を返し、画面が言い切らないようにする */
const MAX_ROWS = 500;

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, driver_id, kind, title, created_at, read_at")
    .eq("org_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(MAX_ROWS);
  if (error) {
    console.error("[notifications/undelivered] load error", error);
    return NextResponse.json({ items: [], unavailable: true });
  }
  const rows = notifications ?? [];
  if (rows.length === 0) return NextResponse.json({ items: [], unavailable: false });

  const ids = rows.map((n) => n.id as string);
  // .in() の件数は200以下に分ける（URLがPostgRESTのヘッダ上限を越えると静かに失敗する）。
  // 1通知が複数チャネルぶんの行を持つので、行数も1000で切り詰められないようページングする。
  type RawDelivery = { notification_id: string; channel: string; status: string; error: string | null };
  let deliveryRows: RawDelivery[];
  try {
    const pages: RawDelivery[][] = [];
    for (let i = 0; i < ids.length; i += IN_CLAUSE_BATCH_SIZE) {
      const batch = ids.slice(i, i + IN_CLAUSE_BATCH_SIZE);
      pages.push(
        await fetchAllRows<RawDelivery>((from, to) =>
          supabase
            .from("notification_deliveries")
            .select("notification_id, channel, status, error")
            .in("notification_id", batch)
            .order("notification_id")
            .order("id")
            .range(from, to),
        ),
      );
    }
    deliveryRows = pages.flat();
  } catch (deliveryError) {
    console.error("[notifications/undelivered] delivery load error", deliveryError);
    return NextResponse.json({ items: [], unavailable: true });
  }

  const summaries = summarizeDeliveries(
    ids,
    deliveryRows.map((row): DeliveryRow => ({
      notificationId: row.notification_id,
      channel: row.channel,
      status: row.status,
      error: row.error ?? null,
    })),
  );
  const summaryById = new Map(summaries.map((s) => [s.notificationId, s]));

  const driverIds = [...new Set(rows.map((n) => n.driver_id as string).filter(Boolean))];
  const nameById = new Map<string, string>();
  for (let i = 0; i < driverIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const { data: drivers } = await supabase
      .from("drivers").select("id, name, display_name").eq("org_id", orgId)
      .in("id", driverIds.slice(i, i + IN_CLAUSE_BATCH_SIZE));
    for (const d of drivers ?? []) nameById.set(d.id as string, (d.display_name || d.name || "") as string);
  }

  const items = rows
    .map((n) => {
      const summary = summaryById.get(n.id as string);
      return {
        id: n.id as string,
        driverId: (n.driver_id as string) ?? null,
        driverName: nameById.get(n.driver_id as string) ?? "",
        kind: n.kind as string,
        title: n.title as string,
        createdAt: n.created_at as string,
        // 本人がインボックスで読んでいれば、外向きに届いていなくても伝わっている
        read: n.read_at != null,
        reason: summary?.reason ?? "no_attempt",
        channels: summary?.channels ?? [],
        resendable: isResendable(summary?.reason ?? "no_attempt"),
      };
    })
    .filter((item) => !summaryById.get(item.id)?.reached);

  // MAX_ROWS で切れている可能性がある＝「全員に届いている」と言い切れない。
  // examined は調べた通知の件数（未着の件数ではない）
  return NextResponse.json({ items, unavailable: false, examined: rows.length, truncated: rows.length >= MAX_ROWS });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => null);
  const ids = Array.isArray((body as { ids?: unknown })?.ids) ? ((body as { ids: unknown[] }).ids) : null;
  if (!ids || ids.length === 0 || ids.length > 50 || !ids.every((id) => typeof id === "string" && id.length > 0)) {
    return NextResponse.json({ error: "再送する通知を選んでください（一度に50件まで）" }, { status: 400 });
  }

  try {
    // 古い一覧を開いたままの再送で「もう届いている通知」を送り直さない。
    // 送る直前に配信ログを見直し、いま再送に値するものだけに絞る
    const { data: deliveryRows, error: deliveryError } = await supabase
      .from("notification_deliveries")
      .select("notification_id, channel, status, error")
      .in("notification_id", ids as string[]);
    if (deliveryError) throw new Error("配信の記録を確認できませんでした");
    const resendable = summarizeDeliveries(
      ids as string[],
      (deliveryRows ?? []).map((row): DeliveryRow => ({
        notificationId: row.notification_id as string,
        channel: row.channel as string,
        status: row.status as string,
        error: (row.error as string | null) ?? null,
      })),
    )
      .filter((summary) => isResendable(summary.reason))
      .map((summary) => summary.notificationId);
    if (resendable.length === 0) {
      return NextResponse.json({ ok: true, result: null, skipped: ids.length });
    }
    // 自社の通知だけを再送する（deliverStoredNotifications 側でも org を確認する）
    const result = await deliverStoredNotifications(orgId, resendable);
    return NextResponse.json({ ok: true, result, skipped: ids.length - resendable.length });
  } catch (e) {
    console.error("[notifications/undelivered] resend failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "再送に失敗しました" }, { status: 500 });
  }
}
