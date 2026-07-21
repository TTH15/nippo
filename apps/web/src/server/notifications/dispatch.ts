// ============================================================
// 通知の生成 → インボックス保存 → チャネル配信（ファンアウト）。
// notification-flow §1-2「アプリ内インボックスが真実、LINE/push は配信」の実装。
//
// ★誤爆防止（§1-3）はこのモジュールに集約する:
//   レイヤ3「送信直前アサート」= assertSameOrg()。バッチ内の全受信者が
//   送信元 org に属することを DB で最終確認し、1件でも外れたらバッチ全体を中断する。
//   レイヤ2「broadcast 禁止」= line/client.ts に broadcast を実装していない。
//   レイヤ4「org_id をレコードが保持」= notifications.org_id から配信先を導出。
//
// 呼び出し側（cron・イベント駆動・手動配信）は受信者リストを必ず
// org スコープのクエリで作ること（レイヤ1）。
// ============================================================
import { supabase } from "@/server/db/client";
import { isLineConfigured, multicastText } from "@/server/line/client";
import { isWebPushConfigured, sendWebPush } from "@/server/notifications/webpush";

export type NotificationInput = {
  /** membership（org 文脈での受信者）。 */
  driverId: string;
  identityId: string;
  kind: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  /** 「org×日×種別×membership」等。同じキーの再送は黙って抑止される。 */
  dedupeKey?: string;
};

export type DispatchResult = {
  created: number;
  /** dedupeKey 衝突で作られなかった件数。 */
  skipped: number;
  lineSent: number;
  lineFailed: number;
  /** Web Push は端末単位の件数（1人が複数端末を持ちうる）。 */
  webPushSent: number;
  webPushFailed: number;
};

/**
 * 送信元 org に属さない受信者を洗い出す（判定の純粋部分・テスト対象）。
 * requested のうち allowed に無いものが越境。
 */
export function detectForeignRecipients(requested: string[], allowed: Iterable<string>): string[] {
  const allowedSet = new Set(allowed);
  return [...new Set(requested)].filter((id) => !allowedSet.has(id));
}

/**
 * レイヤ3: 送信直前アサート。
 * 渡された driverId が全て送信元 org のものであることを DB で確認する。
 * 呼び出し側のクエリが壊れても、ここで越境を止める。
 */
async function assertSameOrg(orgId: string, driverIds: string[]): Promise<void> {
  const unique = [...new Set(driverIds)];
  const { data, error } = await supabase
    .from("drivers")
    .select("id")
    .eq("org_id", orgId)
    .in("id", unique);
  if (error) throw new Error(`受信者の検証に失敗しました: ${error.message}`);

  const foreign = detectForeignRecipients(
    unique,
    (data ?? []).map((d) => d.id as string),
  );
  if (foreign.length > 0) {
    // ここに来るのは呼び出し側のバグ。送らずに落とす（部分送信もしない）。
    throw new Error(
      `テナント越境を検出したため通知を中断しました (org=${orgId}, 対象外=${foreign.length}件)`,
    );
  }
}

/**
 * 通知を生成し、インボックスへ保存してから有効なチャネルへ配信する。
 * インボックスへの保存は必ず成功させ、LINE 配信の失敗は
 * notification_deliveries に記録するだけで全体を失敗させない（取りこぼし優先）。
 */
export async function dispatchNotifications(
  orgId: string,
  inputs: NotificationInput[],
): Promise<DispatchResult> {
  const result: DispatchResult = {
    created: 0,
    skipped: 0,
    lineSent: 0,
    lineFailed: 0,
    webPushSent: 0,
    webPushFailed: 0,
  };
  if (inputs.length === 0) return result;

  await assertSameOrg(orgId, inputs.map((i) => i.driverId));

  // --- インボックス（真実）へ保存 ---
  // dedupe_key は UNIQUE。既存キーの行は ignoreDuplicates で黙って捨てる（＝冪等）。
  const rows = inputs.map((i) => ({
    org_id: orgId,
    driver_id: i.driverId,
    identity_id: i.identityId,
    kind: i.kind,
    title: i.title,
    body: i.body,
    payload: i.payload ?? {},
    dedupe_key: i.dedupeKey ?? null,
  }));

  const { data: created, error } = await supabase
    // tenant-scope-ok: rows の各行に org_id を含む＋直前に assertSameOrg で受信者の越境を遮断
    .from("notifications")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id, identity_id, title, body");
  if (error) throw new Error(`通知の保存に失敗しました: ${error.message}`);

  const inserted = created ?? [];
  result.created = inserted.length;
  result.skipped = inputs.length - inserted.length;
  if (inserted.length === 0) return result;

  const deliveries: { notification_id: string; channel: string; status: string; error?: string }[] = [];

  // --- Web Push へファンアウト（LINE 未連携者にも気づける経路を用意する）---
  // 端末単位。iOS Safari のタブなど購読できない環境ではそもそも購読が無く、
  // その人はインボックスで読むことになる（§1-2）。
  if (isWebPushConfigured()) {
    const payloadByIdentity = new Map(
      inserted.map((n) => [
        n.identity_id as string,
        {
          id: n.id as string,
          title: n.title as string,
          body: n.body as string,
          url: "/notifications",
        },
      ]),
    );
    const pushResult = await sendWebPush(payloadByIdentity);
    result.webPushSent = pushResult.sent;
    result.webPushFailed = pushResult.failed;

    // 端末単位の成否は集計で持つため、ログは通知単位で1行にまとめる
    if (pushResult.sent > 0 || pushResult.failed > 0) {
      for (const n of inserted) {
        deliveries.push({
          notification_id: n.id as string,
          channel: "web_push",
          status: pushResult.sent > 0 ? "sent" : "failed",
        });
      }
    }
  }

  // --- LINE へファンアウト（レイヤ4: 保存済みレコードから配信先を導出）---
  if (!isLineConfigured()) {
    await saveDeliveries(deliveries);
    return result;
  }

  const identityIds = [...new Set(inserted.map((n) => n.identity_id as string))];
  const { data: linked } = await supabase
    .from("identities")
    .select("id, line_user_id")
    .in("id", identityIds)
    .not("line_user_id", "is", null)
    .is("line_blocked_at", null);

  const lineUserIdByIdentity = new Map(
    (linked ?? []).map((r) => [r.id as string, r.line_user_id as string]),
  );

  // 同一本文をまとめて multicast できるようグループ化（1人1通でも push より効率が良い）
  const byMessage = new Map<string, string[]>();
  for (const n of inserted) {
    const lineUserId = lineUserIdByIdentity.get(n.identity_id as string);
    if (!lineUserId) continue; // 未連携＝インボックス＋Web Push のみ（§1-2）
    const text = `${n.title}\n\n${n.body}`;
    const list = byMessage.get(text) ?? [];
    list.push(lineUserId);
    byMessage.set(text, list);
  }

  for (const [text, lineUserIds] of byMessage) {
    const targets = inserted.filter((n) => {
      const uid = lineUserIdByIdentity.get(n.identity_id as string);
      return uid !== undefined && lineUserIds.includes(uid);
    });
    try {
      await multicastText(lineUserIds, text);
      result.lineSent += lineUserIds.length;
      for (const n of targets) {
        deliveries.push({ notification_id: n.id as string, channel: "line", status: "sent" });
      }
    } catch (e) {
      // 配信失敗はログに残すだけ。インボックスには既に届いている。
      const message = e instanceof Error ? e.message : String(e);
      console.error("[notifications] LINE 配信に失敗", message);
      result.lineFailed += lineUserIds.length;
      for (const n of targets) {
        deliveries.push({
          notification_id: n.id as string,
          channel: "line",
          status: "failed",
          error: message.slice(0, 500),
        });
      }
    }
  }

  await saveDeliveries(deliveries);
  return result;
}

/** 配信ログの保存。失敗しても通知そのものは成立しているため throw しない。 */
async function saveDeliveries(
  deliveries: { notification_id: string; channel: string; status: string; error?: string }[],
): Promise<void> {
  if (deliveries.length === 0) return;
  const { error } = await supabase.from("notification_deliveries").insert(deliveries);
  if (error) console.error("[notifications] 配信ログの保存に失敗", error);
}
