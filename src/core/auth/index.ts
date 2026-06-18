// 認証コア（プラットフォーム非依存）のバレル。
// Web は @/lib/api 経由で再エクスポートされるため、既存の import 先は変更不要。
// RN は configureAuth() を起動時に呼んでから get/set/apiFetch を使う。
export type { StoredDriver, KeyValueStorage, UnauthorizedHandler } from "./types";
export {
  configureAuth,
  getToken,
  getStoredDriver,
  setAuth,
  clearAuth,
  handleUnauthorized,
} from "./store";
