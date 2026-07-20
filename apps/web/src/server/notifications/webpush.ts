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

export type PushResult = { sent: number; failed: number };

/**
 * 指定 identity 群の全端末へ push を送る。
 * 1端末の失敗は他へ影響させない（全端末に届けるのが目的のため）。
 */
export async function sendWebPush(
  payloadByIdentity: Map<string, PushPayload>,
): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0 };
  if (!isWebPushConfigured() || payloadByIdentity.size === 0) return result;

  ensureConfigured();

  const identityIds = [...payloadByIdentity.keys()];
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, identity_id, p256dh, auth")
    .in("identity_id", identityIds);
  if (error) {
    console.error("[webpush] 購読の取得に失敗", error);
    return result;
  }

  const expired: string[] = [];

  await Promise.all(
    (subscriptions ?? []).map(async (sub) => {
      const payload = payloadByIdentity.get(sub.identity_id as string);
      if (!payload) return;

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
          },
          JSON.stringify(payload),
        );
        result.sent++;
      } catch (e) {
        result.failed++;
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

  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", expired);
  }

  return result;
}
