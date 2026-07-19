// 認証トークン／ログインドライバーの保管ロジック(プラットフォーム非依存)。
// 実体は @platform/auth へ昇格(ADR-0002)。ここではキー名とドライバー型を束ねて
// 従来と同じ関数名で公開する(既存 import は無改変)。
//   - Web: src/lib/api.ts がモジュール読込時に localStorage アダプタを注入。
//   - RN : アプリ起動時に SecureStore 等のアダプタと navigation ハンドラを注入。
// キー名は保存済みセッションとの互換のため変更しないこと(変更=全ユーザーログアウト)。
import { createAuthStore } from "@platform/auth";
import type { StoredDriver } from "./types";

const store = createAuthStore<StoredDriver>({
  tokenKey: "nippo_token",
  userKey: "nippo_driver",
});

/**
 * プラットフォーム別のストレージ／401遷移を注入する。
 * Web 起動時・RN 起動時にそれぞれ1回呼ぶ(以後の get/set はこの storage 経由)。
 */
export const configureAuth = store.configureAuth;

/** API 呼び出しに付与する Bearer トークンを取得(未ログインなら null)。 */
export const getToken = store.getToken;

/** ログイン中ドライバーを取得(未ログイン／壊れた値なら null)。 */
export const getStoredDriver = store.getStoredUser;

/** ログイン成功時にトークンとドライバーを保存。 */
export const setAuth = store.setAuth;

/** ログアウト／認証破棄。保存値を消すのみ(遷移はしない)。 */
export const clearAuth = store.clearAuth;

/**
 * 401 受信時の処理。保存値を破棄し、注入された遷移ハンドラ(ログイン画面へ)を発火。
 * apiFetch から呼ばれる。
 */
export const handleUnauthorized = store.handleUnauthorized;
