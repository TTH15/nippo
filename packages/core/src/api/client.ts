// API クライアント(プラットフォーム非依存)。
// 実体は @platform/api-client へ昇格(ADR-0002)。ここでは ../auth のストアと
// 束ねて従来と同じ関数名で公開する(既存 import は無改変)。
// Web は相対パス既定のまま、RN は起動時に configureApi({ baseUrl }) で絶対 URL を注入する。
import { createApiClient } from "@platform/api-client";
import { getToken, handleUnauthorized } from "../auth";

const client = createApiClient({
  getToken,
  onUnauthorized: handleUnauthorized,
});

/** API のベースURLを設定する(RN 起動時に絶対オリジンを注入)。 */
export const configureApi = client.configureApi;

/** 設定中のベースURLを取得(テスト・デバッグ用)。 */
export const getApiBaseUrl = client.getApiBaseUrl;

/**
 * 認証付き fetch ラッパ。
 * - Bearer トークンを自動付与(../auth の getToken)。
 * - 401 は handleUnauthorized()(保存値破棄＋ログイン遷移)を発火し throw。
 * - text/csv は Blob、それ以外は JSON を返す。
 * - path が "http" 始まりなら baseUrl を付けずそのまま使う。
 */
export const apiFetch = client.apiFetch;
