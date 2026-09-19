// "@/lib/api" の差し替え。本番の apiFetch / 認証ストレージの代わりに fixture ストアへ読み書きする。
// 初期状態はURLの ?role= に応じた架空ユーザー。同じ画面のSMS認証後はsetAuthの結果を返す。
// @/lib/capabilities（本物）がこれを読み、本番のトークン・ストレージには触れない。
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

let authState: { runtime: ReturnType<typeof getPreviewRuntime>; driver: StoredDriver | null } | null = null;

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
  const runtime = getPreviewRuntime();
  return authState?.runtime === runtime ? authState.driver : runtime.store.driver;
}

export function getToken(): string | null {
  return "preview-token";
}

export function setAuth(_token?: string, driver?: StoredDriver): void {
  authState = { runtime: getPreviewRuntime(), driver: driver ?? null };
}
export function clearAuth(): void { authState = { runtime: getPreviewRuntime(), driver: null }; }
