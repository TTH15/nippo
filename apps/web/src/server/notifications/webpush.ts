// ============================================================
// Web Push 配信（roadmap-2026-07 E⑦）。
// LINE 未連携者にも「気づける」経路を用意するための追加チャネル。
//
// 端末ごとの購読（push_subscriptions）へ暗号化 push を送る。
// 失効した購読（404/410）はその場で削除する — 放置すると毎回失敗し続けるため。
//
// ★iOS はホーム画面追加した PWA でのみ購読できる（Apple の制約で回避不能）。
//   Android Chrome・デスクトップはブラウザタブのままで届く。
//   届かない端末があること自体は想定内で、その受け皿がインボックス（§1-2）。
//
//   env: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
//        （生成: npx web-push generate-vapid-keys）
// ============================================================
import webpush from "web-push";
import { supabase } from "@/server/db/client";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

let configured = false;

/** Web Push が使える設定になっているか（未設定なら黙ってスキップする）。 */
export function isWebPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** ブラウザ側の購読に必要な公開鍵。秘密鍵は絶対に返さない。 */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("Web Push 未設定（VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）");
  }
  // subject は VAPID 仕様上必須。連絡先が無ければアプリの URL でも良い。
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:support@example.com",
    publicKey,
    privateKey,
  );
  configured = true;
}

export type PushPayload = {
  /** 通知レコードの id。SW 側で tag に使い、重複表示を防ぐ。 */
  id: string;
  title: string;
  body: string;
  url?: string;
};

export type PushResult = {
  sent: number;
  failed: number;
  /**
   * **通知ごと**の結果。端末を1台も持たない人は `devices: 0` で入る。
   * 同じ本人宛の通知が複数あっても取り違えないよう、受信者ではなく通知の id をキーにする
   * （受信者キーだと1人ぶんに潰れ、実際は1通しか送っていないのに全部「送信済み」になる）。
   */
  byNotification: Map<string, { sent: number; failed: number; devices: number }>;
};

/** 1通ぶんの送信対象 */
export type PushTarget = { notificationId: string; identityId: string; payload: PushPayload };

/**
 * 指定 identity 群の全端末へ push を送る。
 * 1端末の失敗は他へ影響させない（全端末に届けるのが目的のため）。
 */
export async function sendWebPush(targets: readonly PushTarget[]): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, byNotification: new Map() };
  // 端末を持たない人も「経路が無い」と分かるよう、先に0で埋めておく
  for (const target of targets) {
    result.byNotification.set(target.notificationId, { sent: 0, failed: 0, devices: 0 });
  }
  if (!isWebPushConfigured() || targets.length === 0) return result;

  ensureConfigured();

  // 1人が複数通を受け取ることがあるので、受信者→通知の一覧で持つ
  const targetsByIdentity = new Map<string, PushTarget[]>();
  for (const target of targets) {
    const list = targetsByIdentity.get(target.identityId);
    if (list) list.push(target);
    else targetsByIdentity.set(target.identityId, [target]);
  }
  const identityIds = [...targetsByIdentity.keys()];
  // 200人を超える一斉配信で .in() がURL上限を越えると、購読が取れなかった人が
  // devices:0（＝「通知の許可なし」）として記録され、運営に嘘の理由が出る
  type Subscription = { endpoint: string; identity_id: string; p256dh: string; auth: string };
  let subscriptions: Subscription[];
  try {
    const pages: Subscription[][] = [];
    for (let i = 0; i < identityIds.length; i += IN_CLAUSE_BATCH_SIZE) {
      const batch = identityIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
      pages.push(
        await fetchAllRows<Subscription>((from, to) =>
          supabase
            .from("push_subscriptions")
            .select("endpoint, identity_id, p256dh, auth")
            .in("identity_id", batch)
            .order("identity_id")
            .order("endpoint")
            .range(from, to),
        ),
      );
    }
    subscriptions = pages.flat();
  } catch (error) {
    console.error("[webpush] 購読の取得に失敗", error);
    return result;
  }

  const expired: string[] = [];

  // 端末 × 通知 の総当たり。1人が3通・2端末なら6回送る
  const sends = subscriptions.flatMap((sub) =>
    (targetsByIdentity.get(sub.identity_id as string) ?? []).map((target) => ({ sub, target })),
  );

  await Promise.all(
    sends.map(async ({ sub, target }) => {
      const payload = target.payload;
      const per = result.byNotification.get(target.notificationId) ?? { sent: 0, failed: 0, devices: 0 };
      per.devices += 1;
      result.byNotification.set(target.notificationId, per);

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
          },
          JSON.stringify(payload),
        );
        result.sent++;
        per.sent += 1;
      } catch (e) {
        result.failed++;
        per.failed += 1;
        // 404/410 = 購読が失効（アンインストール・許可取消）。掃除する。
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expired.push(sub.endpoint as string);
        } else {
          console.error("[webpush] 送信に失敗", statusCode, e);
        }
      }
    }),
  );

  // 端末×通知の総当たりなので同じ endpoint が何度も積まれる。
  // 重複を落として分割しないと、失効した購読が消えず毎回失敗し続ける
  const uniqueExpired = [...new Set(expired)];
  for (let i = 0; i < uniqueExpired.length; i += IN_CLAUSE_BATCH_SIZE) {
    const { error: deleteError } = await supabase
      .from("push_subscriptions")
      .delete()
      .in("endpoint", uniqueExpired.slice(i, i + IN_CLAUSE_BATCH_SIZE));
    if (deleteError) console.error("[webpush] 失効した購読の削除に失敗", deleteError);
  }

  return result;
}
