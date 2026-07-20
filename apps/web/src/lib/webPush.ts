// ============================================================
// Web Push のブラウザ側ヘルパー（roadmap-2026-07 E⑦）。
// 「どの環境なら通知を受け取れるか」の判定をここに集約する。
//
// ★iOS はホーム画面に追加した PWA でのみ Push API が提供される（Apple の制約）。
//   Safari のタブで開いている限り window.PushManager 自体が存在しない。
//   回避策は無いので、判定して案内を出し分けるしかない。
// ============================================================

export type PushEnvironment =
  /** 購読できる（Android Chrome・デスクトップ・ホーム画面追加済み iOS）。 */
  | "supported"
  /** iOS の Safari タブ。ホーム画面に追加すれば購読できるようになる。 */
  | "ios_needs_install"
  /** 対応していないブラウザ。LINE 連携かインボックスで受け取ってもらう。 */
  | "unsupported";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ は UA が Mac を名乗るため、タッチ有無で判別する
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || iPadOS;
}

/** ホーム画面から起動している（standalone 表示）か。 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

export function detectPushEnvironment(): PushEnvironment {
  if (typeof window === "undefined") return "unsupported";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    return "supported";
  }
  // iOS でタブ表示なら、ホーム画面追加で "supported" に変わる
  if (isIOS() && !isStandalone()) return "ios_needs_install";
  return "unsupported";
}

/** VAPID 公開鍵（base64url）を PushManager が要求する Uint8Array に変換する。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // applicationServerKey は ArrayBuffer 実体を要求するため、明示的に確保する
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** Service Worker の登録を待って取得する（未登録なら登録する）。 */
async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

/** この端末が既に購読済みかを返す。 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (detectPushEnvironment() !== "supported") return null;
  const registration = await getRegistration();
  return registration.pushManager.getSubscription();
}

export type SubscribeOutcome =
  | { ok: true; subscription: PushSubscriptionJSON }
  | { ok: false; reason: "denied" | "unsupported" | "failed" };

/**
 * 通知の許可を求めて購読する。
 * 許可ダイアログはユーザー操作（クリック）から呼ばないとブラウザに無視されるため、
 * 必ずボタンの onClick から呼ぶこと。
 */
export async function subscribeToPush(publicKey: string): Promise<SubscribeOutcome> {
  if (detectPushEnvironment() !== "supported") return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.subscribe({
      // Web Push 仕様上 true が必須（サイレント通知は許可されない）
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return { ok: true, subscription: subscription.toJSON() };
  } catch (e) {
    console.error("[webpush] 購読に失敗", e);
    return { ok: false, reason: "failed" };
  }
}

/** この端末の購読を解除する。解除できた endpoint を返す。 */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await getExistingSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
