import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { apiFetch, configureApi, getApiBaseUrl } from "./index";
import { configureAuth, setAuth } from "@/core/auth";
import type { KeyValueStorage, StoredDriver } from "@/core/auth";

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const driver: StoredDriver = { id: "d1", name: "山田", role: "driver" };

// 最小の Response モック。
function res(
  body: unknown,
  init?: { status?: number; contentType?: string }
): Response {
  const status = init?.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => (k === "content-type" ? init?.contentType ?? "application/json" : null) },
    json: async () => body,
    blob: async () => body,
  } as unknown as Response;
}

describe("core/api apiFetch", () => {
  let onUnauthorized: Mock<() => void>;
  let fetchMock: Mock<(input: string, init?: RequestInit) => Promise<Response>>;

  beforeEach(() => {
    onUnauthorized = vi.fn();
    configureAuth({ storage: memoryStorage(), onUnauthorized });
    configureApi({ baseUrl: "" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("トークンがあれば Authorization ヘッダを付与し JSON を返す", async () => {
    setAuth("tok123", driver);
    fetchMock.mockResolvedValue(res({ ok: true }));

    const out = await apiFetch<{ ok: boolean }>("/api/me");

    expect(out).toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me");
    expect((opts!.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
  });

  it("未ログインなら Authorization ヘッダを付けない", async () => {
    fetchMock.mockResolvedValue(res({}));
    await apiFetch("/api/me");
    const [, opts] = fetchMock.mock.calls[0];
    expect((opts!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("baseUrl を設定すると絶対URLに前置する", async () => {
    configureApi({ baseUrl: "https://api.example.com" });
    expect(getApiBaseUrl()).toBe("https://api.example.com");
    fetchMock.mockResolvedValue(res({}));

    await apiFetch("/api/me");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/me");
  });

  it("http 始まりの path には baseUrl を付けない", async () => {
    configureApi({ baseUrl: "https://api.example.com" });
    fetchMock.mockResolvedValue(res({}));
    await apiFetch("https://other.test/x");
    expect(fetchMock.mock.calls[0][0]).toBe("https://other.test/x");
  });

  it("401 で handleUnauthorized（遷移ハンドラ）発火＋throw", async () => {
    setAuth("tok123", driver);
    fetchMock.mockResolvedValue(res({}, { status: 401 }));

    await expect(apiFetch("/api/me")).rejects.toThrow("Unauthorized");
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("非OKは body.error を載せて throw", async () => {
    fetchMock.mockResolvedValue(res({ error: "だめ" }, { status: 400 }));
    await expect(apiFetch("/api/me")).rejects.toThrow("だめ");
  });

  it("text/csv は Blob 相当をそのまま返す", async () => {
    fetchMock.mockResolvedValue(res("a,b,c", { contentType: "text/csv" }));
    const out = await apiFetch<string>("/api/export.csv");
    expect(out).toBe("a,b,c");
  });
});
