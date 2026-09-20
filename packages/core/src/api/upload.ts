// multipart/form-data の送信（プラットフォーム非依存）。
// apiFetch は Content-Type を application/json に固定するのでファイル送信に使えない
// （boundary は fetch 実装に決めさせる必要がある）。認証の付け方だけ apiFetch と合わせる。
import { getToken } from "../auth";
import { getApiBaseUrl } from "./client";

export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const url = path.startsWith("http") ? path : `${getApiBaseUrl()}${path}`;
  const response = await fetch(url, {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
