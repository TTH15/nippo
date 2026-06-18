// 認証トークン／ログインドライバーの保管ロジック（プラットフォーム非依存）。
// 実体のストレージと 401 遷移は configureAuth() で注入する。
//   - Web: src/lib/api.ts がモジュール読込時に localStorage アダプタを注入。
//   - RN : アプリ起動時に SecureStore 等のアダプタと navigation ハンドラを注入。
import type { KeyValueStorage, StoredDriver, UnauthorizedHandler } from "./types";

const TOKEN_KEY = "nippo_token";
const DRIVER_KEY = "nippo_driver";

// 未設定・SSR でも落ちないノーオペ実装（デフォルト）。
const noopStorage: KeyValueStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

let storage: KeyValueStorage = noopStorage;
let onUnauthorized: UnauthorizedHandler = () => {};

/**
 * プラットフォーム別のストレージ／401遷移を注入する。
 * Web 起動時・RN 起動時にそれぞれ1回呼ぶ（以後の get/set はこの storage 経由）。
 */
export function configureAuth(opts: {
  storage: KeyValueStorage;
  onUnauthorized?: UnauthorizedHandler;
}): void {
  storage = opts.storage;
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized;
}

/** API 呼び出しに付与する Bearer トークンを取得（未ログインなら null）。 */
export function getToken(): string | null {
  return storage.getItem(TOKEN_KEY);
}

/** ログイン中ドライバーを取得（未ログイン／壊れた値なら null）。 */
export function getStoredDriver(): StoredDriver | null {
  const raw = storage.getItem(DRIVER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredDriver;
  } catch {
    return null;
  }
}

/** ログイン成功時にトークンとドライバーを保存。 */
export function setAuth(token: string, driver: StoredDriver): void {
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(DRIVER_KEY, JSON.stringify(driver));
}

/** ログアウト／認証破棄。保存値を消すのみ（遷移はしない）。 */
export function clearAuth(): void {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(DRIVER_KEY);
}

/**
 * 401 受信時の処理。保存値を破棄し、注入された遷移ハンドラ（ログイン画面へ）を発火。
 * apiFetch から呼ばれる。
 */
export function handleUnauthorized(): void {
  clearAuth();
  onUnauthorized();
}
