// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  token: null as string | null,
  driver: null as { id: string; name: string; role: string } | null,
  fetch: vi.fn(),
}));
vi.mock("@repo/core/auth", () => ({
  configureAuth: vi.fn(),
  getToken: () => mock.token,
  getStoredDriver: () => mock.driver,
  setAuth: (token: string, driver: { id: string; name: string; role: string }) => { mock.token = token; mock.driver = driver; },
  clearAuth: () => { mock.token = null; mock.driver = null; },
}));
vi.mock("@repo/core/api", () => ({ apiFetch: mock.fetch }));

import { apiFetch, clearAuth, getAdminToken, renewAdminToken, setAuth, setLoginSession } from "./api";

const driver = { id: "member-1", name: "試験者", role: "DRIVER" };

beforeEach(() => {
  mock.token = null;
  mock.driver = null;
  mock.fetch.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ adminToken: "renewed-admin-token" }), { status: 200 })));
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/admin");
});

describe("同じアカウントの業務・運営セッション", () => {
  it("運営APIには短命トークン、セッション同期には業務トークンを使う", async () => {
    setLoginSession("work-token", driver, "admin-token");
    await apiFetch("/api/admin/payments");
    expect(mock.fetch).toHaveBeenCalledWith("/api/admin/payments", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer admin-token" }),
    }), expect.objectContaining({ skipAuthRedirect: true }));
    await apiFetch("/api/auth/session");
    expect(mock.fetch).toHaveBeenLastCalledWith("/api/auth/session", {}, {});
    expect(mock.token).toBe("work-token");
  });

  it("権限同期では運営トークンを残し、アカウント変更とSMS再ログインでは破棄する", () => {
    setLoginSession("work-token", driver, "admin-token");
    setAuth("renewed-work-token", driver);
    expect(getAdminToken()).toBe("admin-token");
    setAuth("other-work-token", { ...driver, id: "member-2" });
    expect(getAdminToken()).toBeNull();
    setLoginSession("work-token", driver, "admin-token");
    setLoginSession("sms-work-token", driver);
    expect(getAdminToken()).toBeNull();
    clearAuth();
    expect(mock.token).toBeNull();
  });

  it("新しいタブでは業務セッションとCookieで運営トークンを復元する", async () => {
    setAuth("work-token", driver);
    expect(await renewAdminToken()).toBe("renewed-admin-token");
    expect(getAdminToken()).toBe("renewed-admin-token");
    expect(fetch).toHaveBeenCalledWith("/api/auth/admin/refresh", expect.objectContaining({
      method: "POST", credentials: "same-origin", headers: { Authorization: "Bearer work-token" },
    }));
  });

  it("運営APIの期限切れは自動更新して1回再送する", async () => {
    setLoginSession("work-token", driver, "expired-admin-token");
    mock.fetch.mockRejectedValueOnce(new Error("Unauthorized")).mockResolvedValueOnce({ ok: true });
    await apiFetch("/api/admin/payments");
    expect(mock.fetch).toHaveBeenCalledTimes(2);
    expect(mock.fetch).toHaveBeenLastCalledWith("/api/admin/payments", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer renewed-admin-token" }),
    }), expect.objectContaining({ skipAuthRedirect: true }));
  });
});
