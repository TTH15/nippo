/// <reference types="node" />
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
vi.mock("../src/auth/secureStoreStorage", () => ({ secureStoreStorage: { setItem: vi.fn(), removeItem: vi.fn(), getItem: vi.fn() } }));
const withUiPreview = require("../ui-preview/metro.cjs");
const root = "/workspace/apps/mobile";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
it("通常ビルドのresolverを変えない", () => {
  vi.stubEnv("HAKOTORA_UI_PREVIEW", "");
  const config = { resolver: {} };
  expect(withUiPreview(config, root)).toBe(config);
  expect(config.resolver).toEqual({});
});
it("devだけをfixtureへ解決し、本番サービスと配布向けbundleを拒否する", () => {
  vi.stubEnv("HAKOTORA_UI_PREVIEW", "1");
  const config = withUiPreview({ resolver: {} }, root);
  const context = { dev: true, originModulePath: path.join(root, "index.ts"), resolveRequest: (_: unknown, name: string) => ({ type: "sourceFile", filePath: path.join(root, name) }) };
  expect(config.resolver.resolveRequest(context, "@repo/core/api", "ios").filePath).toBe(path.join(root, "ui-preview/services.ts"));
  expect(config.resolver.resolveRequest(context, "src/bootstrap.ts", "ios").filePath).toBe(path.join(root, "ui-preview/services.ts"));
  expect(config.resolver.resolveRequest(context, "App.tsx", "ios").filePath).toBe(path.join(root, "ui-preview/App.tsx"));
  expect(config.resolver.resolveRequest({ ...context, originModulePath: path.join(root, "src/auth/secureStoreStorage.ts") }, "expo-secure-store", "ios").filePath).toBe(path.join(root, "ui-preview/auth-secure-store.ts"));
  expect(() => config.resolver.resolveRequest(context, "@platform/api-client", "ios")).toThrow();
  expect(() => config.resolver.resolveRequest({ ...context, dev: false }, "@repo/core/api", "ios")).toThrow();
  expect(() => config.resolver.resolveRequest({ ...context, customResolverOptions: { exporting: true } }, "@repo/core/api", "ios")).toThrow();
});
it("架空の出退勤・日報・認証をメモリ内で処理し、未対応APIは送信しない", async () => {
  vi.stubGlobal("__DEV__", true);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const api = await import("../ui-preview/services");
  await api.apiFetch("/api/work/check-in", { method: "POST" });
  expect(await api.apiFetch("/api/work/today")).toMatchObject({ open: { vehicle_id: "preview-vehicle" } });
  await api.apiFetch("/api/work/check-out", { method: "POST" });
  expect(await api.apiFetch("/api/work/today")).toMatchObject({ open: null, today: [{ status: "closed" }] });
  expect(await api.apiFetch("/api/reports/v2", { method: "POST", body: "{}" })).toMatchObject({ ok: true });
  await expect(api.apiFetch("/api/unknown")).rejects.toThrow("未対応");
  await expect(api.apiUpload()).rejects.toThrow("送信しません");
  api.clearAuth(); expect(api.getStoredDriver()).toBeNull();
  api.setAuth(); expect(api.getStoredDriver()?.id).toBe("preview-driver");
  expect(fetch).not.toHaveBeenCalled();
});
it("ログイン確認の端末保存失敗は一度だけ発生し、再試行できる", async () => {
  vi.stubGlobal("__DEV__", true);
  const storage = await import("../ui-preview/auth-secure-store");
  storage.failNextAuthSave();
  await expect(storage.setItemAsync("nippo_token", "preview-only")).rejects.toThrow();
  await storage.setItemAsync("nippo_token", "preview-only");
  expect(await storage.getItemAsync("nippo_token")).toBe("preview-only");
});
it("fixture自身もproductionでの実行を拒否する", async () => {
  vi.stubGlobal("__DEV__", false);
  await expect(import("../ui-preview/services")).rejects.toThrow("開発サーバー専用");
});
