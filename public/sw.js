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
