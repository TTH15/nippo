"use client";

// Web プラットフォームの認証束縛点。
// 認証ロジックの実体は @repo/core/auth（プラットフォーム非依存）にあり、ここでは
// Web 用ストレージ（localStorage）と 401 遷移（window.location）を注入する。
// 既存の各画面は従来どおり @/lib/api から import すればよい（実体を再エクスポート）。
import { configureAuth, getStoredDriver, getToken, setAuth as setCoreAuth, clearAuth as clearCoreAuth, type KeyValueStorage, type StoredDriver } from "@repo/core/auth";
import { apiFetch as coreApiFetch } from "@repo/core/api";

const ADMIN_TOKEN_KEY = "nippo_admin_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "null") as { driverId?: string; token?: string } | null;
    return value?.driverId === getStoredDriver()?.id && typeof value?.token === "string" ? value.token : null;
  } catch { return null; }
}

function clearAdminToken() {
  try { if (typeof window !== "undefined") window.sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* ストレージ制限時も通常ログインを止めない */ }
}

function setAdminToken(token: string | null, driverId: string) {
  clearAdminToken();
  if (token && typeof window !== "undefined") {
    try { window.sessionStorage.setItem(ADMIN_TOKEN_KEY, JSON.stringify({ driverId, token })); } catch { /* 通常業務のログインは保持する */ }
  }
}

let adminRenewal: Promise<string | null> | null = null;

/** Cookie と業務セッションの両方が有効な場合だけ、運営トークンを自動更新する。 */
export async function renewAdminToken(): Promise<string | null> {
  if (adminRenewal) return adminRenewal;
  const workToken = getToken();
  const driverId = getStoredDriver()?.id;
  if (!workToken || !driverId || typeof window === "undefined") return null;
  adminRenewal = (async () => {
    const response = await fetch("/api/auth/admin/refresh", {
      method: "POST", credentials: "same-origin",
      headers: { Authorization: `Bearer ${workToken}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearAdminToken();
      return null;
    }
    if (!response.ok) throw new Error("運営画面の接続を確認できませんでした");
    const body = await response.json() as { adminToken?: string };
    if (!body.adminToken || getStoredDriver()?.id !== driverId) return null;
    setAdminToken(body.adminToken, driverId);
    return body.adminToken;
  })().finally(() => { adminRenewal = null; });
  return adminRenewal;
}

export function setAuth(token: string, driver: StoredDriver) {
  if (getStoredDriver()?.id !== driver.id) clearAdminToken();
  setCoreAuth(token, driver);
}

/** ログイン時は以前の運営セッションを破棄し、今回確認した本人のものだけを保存する。 */
export function setLoginSession(token: string, driver: StoredDriver, adminToken?: string | null) {
  setCoreAuth(token, driver);
  setAdminToken(adminToken ?? null, driver.id);
}

export function clearAuth() {
  if (typeof window !== "undefined") {
    void fetch("/api/auth/admin/logout", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
  }
  clearAdminToken();
  clearCoreAuth();
}

const isAdminRequest = (path: string) => path.startsWith("/api/admin/") ||
  (typeof window !== "undefined" && window.location.pathname.startsWith("/admin") && !path.startsWith("/api/auth/"));

function requestAdminLogin() {
  clearAdminToken();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/preview/")) {
    window.location.href = "/login?next=admin";
  }
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}, opts: { skipAuthRedirect?: boolean } = {}): Promise<T> {
  if (!isAdminRequest(path)) return coreApiFetch<T>(path, options, opts);
  const token = getAdminToken() ?? await renewAdminToken();
  if (!token) {
    requestAdminLogin();
    throw new Error("運営画面にはかんたんログインが必要です");
  }
  const call = (credential: string) => coreApiFetch<T>(path, {
    ...options,
    headers: { ...((options.headers as Record<string, string>) ?? {}), Authorization: `Bearer ${credential}` },
  }, { ...opts, skipAuthRedirect: true });
  try { return await call(token); }
  catch (error) {
    if (!(error instanceof Error) ||
        (error.message !== "Unauthorized" && !error.message.includes("ログインし直してください"))) throw error;
    const renewed = await renewAdminToken();
    if (!renewed) { requestAdminLogin(); throw error; }
    try { return await call(renewed); }
    catch (retryError) {
      if (retryError instanceof Error &&
          (retryError.message === "Unauthorized" || retryError.message.includes("ログインし直してください"))) requestAdminLogin();
      throw retryError;
    }
  }
}

export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const admin = isAdminRequest(path);
  const token = admin ? (getAdminToken() ?? await renewAdminToken()) : getToken();
  if (!token && admin) {
    requestAdminLogin();
    throw new Error("運営画面にはかんたんログインが必要です");
  }
  const send = (credential: string | null) => fetch(path, { method: "POST", body: form,
    headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
  let response = await send(token);
  if (response.status === 401 && admin) {
    const renewed = await renewAdminToken();
    if (!renewed) requestAdminLogin();
    else response = await send(renewed);
  }
  if (response.status === 401 && admin) requestAdminLogin();
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `送信できませんでした（HTTP ${response.status}）`);
  }
  return response.json() as Promise<T>;
}

// SSR でも落ちない localStorage アダプタ。
const webStorage: KeyValueStorage = {
  getItem: (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
};

// このモジュールが読み込まれた時点（＝ apiFetch 等を import した時点）で Web 設定を注入。
configureAuth({
  storage: webStorage,
  onUnauthorized: () => {
    if (typeof window !== "undefined") {
      clearAdminToken();
      window.location.href = "/login";
    }
  },
});

// 既存の import 互換のため core の API を再エクスポート。
// apiFetch の実体は @repo/core/api（fetch本体は Web/RN 共有）。Web は baseUrl 既定（相対パス）
// のままで従来挙動と同一なので configureApi の呼び出しは不要。
export { getToken, getStoredDriver };
export type { StoredDriver } from "@repo/core/auth";
