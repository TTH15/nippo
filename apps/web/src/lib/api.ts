"use client";

// Web プラットフォームの認証束縛点。
// 認証ロジックの実体は @/core/auth（プラットフォーム非依存）にあり、ここでは
// Web 用ストレージ（localStorage）と 401 遷移（window.location）を注入する。
// 既存の各画面は従来どおり @/lib/api から import すればよい（実体を再エクスポート）。
import { configureAuth, type KeyValueStorage } from "@/core/auth";

// SSR でも落ちない localStorage アダプタ。
const webStorage: KeyValueStorage = {
  getItem: (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
};

// このモジュールが読み込まれた時点（＝ apiFetch 等を import した時点）で Web 設定を注入。
configureAuth({
  storage: webStorage,
  onUnauthorized: () => {
    if (typeof window !== "undefined") window.location.href = "/login";
  },
});

// 既存の import 互換のため core の API を再エクスポート。
// apiFetch の実体は @/core/api（fetch本体は Web/RN 共有）。Web は baseUrl 既定（相対パス）
// のままで従来挙動と同一なので configureApi の呼び出しは不要。
export {
  getToken,
  getStoredDriver,
  setAuth,
  clearAuth,
} from "@/core/auth";
export type { StoredDriver } from "@/core/auth";
export { apiFetch } from "@/core/api";
