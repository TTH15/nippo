// "@/lib/api" の差し替え。本番の apiFetch / 認証ストレージの代わりに fixture ストアへ読み書きする。
// getStoredDriver は URL の ?role= に応じた架空の管理者を返し、@/lib/capabilities（本物）がそれを読む。
import { getPreviewRuntime } from "./runtime";

export type StoredDriver = {
  id: string;
  name: string;
  role: string;
  companyCode?: string;
  officeCode?: string;
  driverCode?: string;
  capabilities?: string[];
};

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const { store } = getPreviewRuntime();
  return (await store.fetch(path, { method: init?.method, body: init?.body })) as T;
}

export function getStoredDriver(): StoredDriver | null {
  return getPreviewRuntime().store.driver;
}

export function getToken(): string | null {
  return "preview-token";
}

export function setAuth(): void {}
export function clearAuth(): void {}
