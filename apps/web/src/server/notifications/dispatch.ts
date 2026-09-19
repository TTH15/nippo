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
import { isLineConfigured, multicastMessages, type LineMessage } from "@/server/line/client";
import { IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import { isWebPushConfigured, sendWebPush, type PushTarget } from "@/server/notifications/webpush";

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
  /**
   * LINE に送る見た目（カード等）。省略時は title/body のテキストを送る。
   * インボックスに入るのは常に title/body の方（§1-2 真実はインボックス）。
   */
  lineMessages?: LineMessage[];
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
 * 入力と保存済みレコードを突き合わせる鍵。
 * dedupe_key があればそれが一意。無い入力（手動配信など）は
 * 受信者＋件名＋本文で引く（同じ値なら同じメッセージなので取り違えても実害が無い）。
 */
function messageKeyOf(row: {
  identity_id?: unknown;
  identityId?: string;
  title: unknown;
  body: unknown;
  dedupe_key?: unknown;
  dedupeKey?: string;
}): string {
  const dedupe = (row.dedupeKey ?? row.dedupe_key) as string | null | undefined;
  if (dedupe) return `k:${dedupe}`;
  const identityId = (row.identityId ?? row.identity_id) as string;
  return `f:${identityId} ${row.title as string} ${row.body as string}`;
}

/**
 * レイヤ3: 送信直前アサート。
 * 渡された driverId が全て送信元 org のものであることを DB で確認する。
 * 呼び出し側のクエリが壊れても、ここで越境を止める。
 */
async function assertSameOrg(orgId: string, driverIds: string[]): Promise<void> {
  const unique = [...new Set(driverIds)];
  // ★ここだけは 200分割を落とせない。URL上限で取りこぼすと「自社の人が見つからない」→
  //   越境検出として全員への配信が止まり、他社データが無いのに越境アラートが出る
  const allowed: string[] = [];
  for (let i = 0; i < unique.length; i += IN_CLAUSE_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("drivers")
      .select("id")
      .eq("org_id", orgId)
      .in("id", unique.slice(i, i + IN_CLAUSE_BATCH_SIZE));
    if (error) throw new Error(`受信者の検証に失敗しました: ${error.message}`);
    for (const row of data ?? []) allowed.push(row.id as string);
  }

  const foreign = detectForeignRecipients(unique, allowed);
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

  // .select() の戻り行は db-max-rows（既定1000）で切り詰められる。切り詰められた通知は
  // 保存はされるのに配信も配信ログも走らないので、まとめず分けて入れる
  const INSERT_BATCH = 500;
  const inserted: StoredNotification[] = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { data: created, error } = await supabase
      .from("notifications") // tenant-scope-ok: rows の各行に org_id を含む＋直前に assertSameOrg で受信者の越境を遮断
      .upsert(rows.slice(i, i + INSERT_BATCH), { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id, identity_id, title, body, dedupe_key");
    if (error) throw new Error(`通知の保存に失敗しました: ${error.message}`);
    for (const row of created ?? []) inserted.push(row as StoredNotification);
  }

  result.created = inserted.length;
  result.skipped = inputs.length - inserted.length;
  if (inserted.length === 0) return result;

  return deliverNotifications(inserted, inputs, result);
}

type StoredNotification = { id: string; identity_id: string; title: string; body: string; dedupe_key: string | null };

/** 鍵変更と同時に保存済みの通知を配信する。保存済み会社・本人から宛先を導く。 */
export async function deliverStoredNotifications(orgId: string, ids: string[]): Promise<DispatchResult> {
  const { data, error } = await supabase.from("notifications")
    .select("id, driver_id, identity_id, title, body, dedupe_key").eq("org_id", orgId).in("id", ids);
  if (error) throw new Error("保存済み通知の取得に失敗しました");
  // driver_id が NULL の通知（会社宛など）は受信者の照合対象にしない。
  // 1件混ざっただけで越境扱いになり、バッチ全体が止まってしまう
  await assertSameOrg(orgId, (data ?? []).map((n) => n.driver_id as string | null).filter((id): id is string => !!id));
  return deliverNotifications(data ?? [], [], {
    created: 0, skipped: 0, lineSent: 0, lineFailed: 0, webPushSent: 0, webPushFailed: 0,
  });
}

async function deliverNotifications(inserted: StoredNotification[], inputs: NotificationInput[], result: DispatchResult): Promise<DispatchResult> {
  if (inserted.length === 0) return result;
  const deliveries: { notification_id: string; channel: string; status: string; error?: string }[] = [];

  // --- Web Push へファンアウト（LINE 未連携者にも気づける経路を用意する）---
  // 端末単位。iOS Safari のタブなど購読できない環境ではそもそも購読が無く、
  // その人はインボックスで読むことになる（§1-2）。
  if (isWebPushConfigured()) {
    // 同じ本人宛の通知が複数あっても潰さない（Map のキーを通知にする）
    const targets: PushTarget[] = inserted.map((n) => ({
      notificationId: n.id as string,
      identityId: n.identity_id as string,
      payload: {
        id: n.id as string,
        title: n.title as string,
        body: n.body as string,
        url: "/notifications",
      },
    }));
    const pushResult = await sendWebPush(targets);
    result.webPushSent = pushResult.sent;
    result.webPushFailed = pushResult.failed;

    // ★通知ごとに記録する。バッチ全体の成否を各通知へ同じように書くと
    //   「誰に届いていないか」が分からなくなる（設計 O-2）。
    for (const n of inserted) {
      const per = pushResult.byNotification.get(n.id as string);
      if (!per) continue;
      if (per.devices === 0) {
        // 端末を1台も持っていない＝この経路では届かない
        deliveries.push({ notification_id: n.id as string, channel: "web_push", status: "skipped", error: "no_subscription" });
      } else if (per.sent > 0) {
        deliveries.push({ notification_id: n.id as string, channel: "web_push", status: "sent" });
      } else {
        deliveries.push({ notification_id: n.id as string, channel: "web_push", status: "failed" });
      }
    }
  }

  // --- LINE へファンアウト（レイヤ4: 保存済みレコードから配信先を導出）---
  if (!isLineConfigured()) {
    // 未設定も「この経路では届かない」として残す（黙って消さない）
    for (const n of inserted) {
      deliveries.push({ notification_id: n.id as string, channel: "line", status: "skipped", error: "not_configured" });
    }
    await saveDeliveries(deliveries);
    return result;
  }

  const identityIds = [...new Set(inserted.map((n) => n.identity_id as string))];
  // 200件を超える .in() は URL 上限で静かに失敗する。取れなかった人は
  // 「未連携」として記録されてしまうので、必ず分割して引く
  const lineUserIdByIdentity = new Map<string, string>();
  for (let i = 0; i < identityIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const { data: linked, error: linkedError } = await supabase
      .from("identities")
      .select("id, line_user_id")
      .in("id", identityIds.slice(i, i + IN_CLAUSE_BATCH_SIZE))
      .not("line_user_id", "is", null)
      .is("line_blocked_at", null);
    if (linkedError) {
      console.error("[notifications] LINE 連携の取得に失敗", linkedError);
      continue;
    }
    for (const row of linked ?? []) lineUserIdByIdentity.set(row.id as string, row.line_user_id as string);
  }

  // 保存された行から、入力（＝LINE の見た目）を引き直す。
  // upsert は挿入された行しか返さないため、dedupeKey が無い入力も引けるよう
  // 「受信者＋件名＋本文」を予備キーにする。
  const inputByKey = new Map(inputs.map((i) => [messageKeyOf(i), i]));

  // 同一メッセージをまとめて multicast できるようグループ化（1人1通でも push より効率が良い）
  type Group = { messages: LineMessage[]; lineUserIds: string[]; notificationIds: string[] };
  const groups = new Map<string, Group>();

  for (const n of inserted) {
    const lineUserId = lineUserIdByIdentity.get(n.identity_id as string);
    if (!lineUserId) {
      // 未連携＝インボックス＋Web Push のみ（§1-2）。
      // 「送れなかった」ではなく「経路が無い」ことを記録して、運営が代替連絡を取れるようにする
      deliveries.push({ notification_id: n.id as string, channel: "line", status: "skipped", error: "unlinked" });
      continue;
    }

    const input = inputByKey.get(messageKeyOf(n));
    const messages: LineMessage[] = input?.lineMessages ?? [
      { type: "text", text: `${n.title}\n\n${n.body}` },
    ];

    const key = JSON.stringify(messages);
    const group = groups.get(key) ?? { messages, lineUserIds: [], notificationIds: [] };
    group.lineUserIds.push(lineUserId);
    group.notificationIds.push(n.id as string);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    try {
      await multicastMessages(group.lineUserIds, group.messages);
      result.lineSent += group.lineUserIds.length;
      for (const id of group.notificationIds) {
        deliveries.push({ notification_id: id, channel: "line", status: "sent" });
      }
    } catch (e) {
      // 配信失敗はログに残すだけ。インボックスには既に届いている。
      const message = e instanceof Error ? e.message : String(e);
      console.error("[notifications] LINE 配信に失敗", message);
      result.lineFailed += group.lineUserIds.length;
      for (const id of group.notificationIds) {
        deliveries.push({
          notification_id: id,
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
  // チャネルごとに分けて入れる。1行でも CHECK に当たると insert 全体が落ちるため、
  // 片方の不備でもう片方のログまで失うことがないようにする
  // （migration 173 未適用の環境では web_push が CHECK に当たる）。
  const byChannel = new Map<string, typeof deliveries>();
  for (const row of deliveries) {
    const list = byChannel.get(row.channel);
    if (list) list.push(row);
    else byChannel.set(row.channel, [row]);
  }
  for (const [channel, rows] of byChannel) {
    const { error } = await supabase.from("notification_deliveries").insert(rows);
    if (error) console.error(`[notifications] 配信ログの保存に失敗 (${channel})`, error);
  }
}
