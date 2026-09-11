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

export async function apiFetch<T = unknown>(path: string, init?: RequestInit, options?: { skipAuthRedirect?: boolean }): Promise<T> {
  const { store, navigate } = getPreviewRuntime();
  try {
    return (await store.fetch(path, { method: init?.method, body: init?.body })) as T;
  } catch (error) {
    // fixtureが明示的に401を返すシナリオだけ、本番と同じログイン導線を試す。
    if (!options?.skipAuthRedirect && error instanceof Error && "status" in error && error.status === 401) {
      navigate("/login");
    }
    throw error;
  }
}

export function getStoredDriver(): StoredDriver | null {
  return getPreviewRuntime().store.driver;
}

export function getToken(): string | null {
  return "preview-token";
}

export function setAuth(_token?: string, _driver?: StoredDriver): void {}
export function clearAuth(): void {}
