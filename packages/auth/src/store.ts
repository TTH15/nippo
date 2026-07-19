// 認証トークン/ログインユーザーの保管ロジック(プラットフォーム非依存)。
// 実体のストレージと 401 遷移は configureAuth() で注入する。
// ユーザー型とストレージキーはアプリごとに異なるため、createAuthStore で生成する。
import type { KeyValueStorage, UnauthorizedHandler } from "./types";

// 未設定・SSR でも落ちないノーオペ実装(デフォルト)。
const noopStorage: KeyValueStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export interface AuthStore<TUser> {
  /**
   * プラットフォーム別のストレージ/401遷移を注入する。
   * Web 起動時・RN 起動時にそれぞれ1回呼ぶ(以後の get/set はこの storage 経由)。
   */
  configureAuth(opts: { storage: KeyValueStorage; onUnauthorized?: UnauthorizedHandler }): void;
  /** API 呼び出しに付与する Bearer トークンを取得(未ログインなら null)。 */
  getToken(): string | null;
  /** ログイン中ユーザーを取得(未ログイン/壊れた値なら null)。 */
  getStoredUser(): TUser | null;
  /** ログイン成功時にトークンとユーザーを保存。 */
  setAuth(token: string, user: TUser): void;
  /** ログアウト/認証破棄。保存値を消すのみ(遷移はしない)。 */
  clearAuth(): void;
  /** 401 受信時の処理。保存値を破棄し、注入された遷移ハンドラ(ログイン画面へ)を発火。 */
  handleUnauthorized(): void;
}

/**
 * 認証ストアを生成する。キー名は既存アプリの保存済みセッションと互換になるよう
 * アプリ側が明示的に指定する(キーを変えると全ユーザーがログアウトされるため)。
 */
export function createAuthStore<TUser>(opts: {
  tokenKey: string;
  userKey: string;
}): AuthStore<TUser> {
  const { tokenKey, userKey } = opts;
  let storage: KeyValueStorage = noopStorage;
  let onUnauthorized: UnauthorizedHandler = () => {};

  const store: AuthStore<TUser> = {
    configureAuth(o) {
      storage = o.storage;
      if (o.onUnauthorized) onUnauthorized = o.onUnauthorized;
    },
    getToken() {
      return storage.getItem(tokenKey);
    },
    getStoredUser() {
      const raw = storage.getItem(userKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as TUser;
      } catch {
        return null;
      }
    },
    setAuth(token, user) {
      storage.setItem(tokenKey, token);
      storage.setItem(userKey, JSON.stringify(user));
    },
    clearAuth() {
      storage.removeItem(tokenKey);
      storage.removeItem(userKey);
    },
    handleUnauthorized() {
      store.clearAuth();
      onUnauthorized();
    },
  };
  return store;
}
