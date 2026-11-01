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

import { apiUpload, apiFetch, clearAuth, getAdminToken, renewAdminToken, setAuth, setLoginSession } from "./api";

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

  it("権限同期では運営トークンを残し、アカウント変更とSMS再ログインでは破棄する", async () => {
    setLoginSession("work-token", driver, "admin-token");
    setAuth("renewed-work-token", driver);
    expect(getAdminToken()).toBe("admin-token");
    setAuth("other-work-token", { ...driver, id: "member-2" });
    expect(getAdminToken()).toBeNull();
    setLoginSession("work-token", driver, "admin-token");
    setLoginSession("sms-work-token", driver);
    expect(getAdminToken()).toBeNull();
    await clearAuth();
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


it("アップロードの中止をfetchへ伝え、ログイン状態を保つ",async()=>{
 setLoginSession("work-token",driver,"admin-token");
 const controller=new AbortController();
 vi.mocked(fetch).mockImplementationOnce((_path,init)=>new Promise((_resolve,reject)=>{
   init?.signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
 }));
 const form=new FormData();form.set("file",new File(["sample"],"memo.png"));
 const uploading=apiUpload("/api/admin/shifts/memo/read",form,controller.signal);
 controller.abort();
 await expect(uploading).rejects.toMatchObject({name:"AbortError"});
 expect(fetch).toHaveBeenCalledWith("/api/admin/shifts/memo/read",expect.objectContaining({signal:controller.signal,headers:{Authorization:"Bearer admin-token"}}));
 expect(getAdminToken()).toBe("admin-token");
});

it("失効APIの応答が失敗した場合はログイン情報を残して再試行できる", async () => {
 setLoginSession("work-token",driver,"admin-token");
 vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:503}));
 await expect(clearAuth()).rejects.toThrow("ログアウトを完了できませんでした");
 expect(mock.token).toBe("work-token");expect(getAdminToken()).toBe("admin-token");
 vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:200}));
 await clearAuth();expect(mock.token).toBeNull();expect(getAdminToken()).toBeNull();
 expect(fetch).toHaveBeenLastCalledWith("/api/auth/logout",expect.objectContaining({headers:expect.objectContaining({Authorization:"Bearer work-token"}),body:JSON.stringify({adminToken:"admin-token"})}));
});
