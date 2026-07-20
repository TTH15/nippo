// PWA インストール対応のための最小 Service Worker。
// オフラインキャッシュは行わず、fetch はネットワークへ素通し（passthrough）する。
// fetch ハンドラを持つことでインストール要件を満たしつつ、
// 古いコンテンツを配信してしまうリスクを避ける。

self.addEventListener("install", () => {
  // 即座に新しい SW を有効化する。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 旧バージョンで作成された可能性のあるキャッシュを掃除しておく。
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", () => {
  // respondWith を呼ばないため、リクエストは通常どおりネットワークへ流れる。
  // インストール判定に必要な fetch ハンドラの存在のみを満たす。
});

// ============================================================
// Web Push（roadmap-2026-07 E⑦）。
// サーバーの server/notifications/webpush.ts が送るペイロードを表示する。
// 本文は通知レコードそのもので、タップするとお知らせ画面へ遷移する。
// ============================================================

self.addEventListener("push", (event) => {
  // ペイロード無し（配信テスト等）でも通知だけは出す
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "ハコ虎";
  const options = {
    body: payload.body || "",
    icon: "/logo/icon-192.png",
    badge: "/logo/icon-192.png",
    // 同じ通知が複数端末・複数回で重複表示されるのを防ぐ
    tag: payload.id || undefined,
    data: { url: payload.url || "/notifications" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    (async () => {
      // 既に開いているタブがあればそれを使い回す（タブが増え続けるのを防ぐ）
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
