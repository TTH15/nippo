// 認証まわりのプラットフォーム非依存な型。
// Web は localStorage + window.location、RN は SecureStore + navigation を
// それぞれ KeyValueStorage / UnauthorizedHandler として注入する。

/**
 * 同期キー値ストレージの抽象。
 * - Web: window.localStorage(同期)
 * - RN: 起動時に SecureStore/AsyncStorage から読み込んだ値をメモリに保持し、
 *       そのメモリキャッシュを同期で読み書きする実装を注入する想定。
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 認証切れ(401)検出時の遷移ハンドラ。Web=window.location / RN=navigation。 */
export type UnauthorizedHandler = () => void;
