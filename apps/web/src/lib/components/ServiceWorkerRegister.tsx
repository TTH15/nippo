"use client";

import { useEffect } from "react";

// Service Worker を登録するクライアントコンポーネント。
// ルートレイアウトに一度だけ配置する。本番(HTTPS) / localhost でのみ動作する。
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => {
          // 登録失敗は致命的ではないため握りつぶす（ログのみ）。
          console.warn("Service Worker の登録に失敗しました", err);
        });
    };

    // 初期ロードの邪魔をしないよう load 後に登録する。
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
