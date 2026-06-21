// API クライアント（プラットフォーム非依存）。
// fetch / Blob は Web・RN 双方に存在するため本体は共有できる。
// 唯一の差分はベースURL: Web は相対パス（同一オリジン）、RN は絶対オリジンが
// 必要なため configureApi({ baseUrl }) で注入する。
// 認証トークンと 401 遷移は ../auth に委譲する。
import { getToken, handleUnauthorized } from "../auth";

// 既定は空文字＝相対パス（Web の従来挙動）。RN は起動時に絶対URLを注入する。
let baseUrl = "";

/** API のベースURLを設定する（RN 起動時に絶対オリジンを注入）。 */
export function configureApi(opts: { baseUrl?: string }): void {
  if (opts.baseUrl !== undefined) baseUrl = opts.baseUrl;
}

/** 設定中のベースURLを取得（テスト・デバッグ用）。 */
export function getApiBaseUrl(): string {
  return baseUrl;
}

/**
 * 認証付き fetch ラッパ。
 * - Bearer トークンを自動付与（../auth の getToken）。
 * - 401 は handleUnauthorized()（保存値破棄＋ログイン遷移）を発火し throw。
 * - text/csv は Blob、それ以外は JSON を返す。
 * - path が "http" 始まりなら baseUrl を付けずそのまま使う。
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  // Handle CSV or non-JSON
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/csv")) {
    return (await res.blob()) as unknown as T;
  }

  return res.json();
}
