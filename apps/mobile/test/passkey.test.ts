import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ apiFetch: vi.fn(), get: vi.fn(), create: vi.fn(), isSupported: vi.fn() }));
vi.mock("@repo/core/api", () => ({ apiFetch: mock.apiFetch }));
vi.mock("react-native-passkey", () => ({ Passkey: mock }));
import { supportsPasskey, loginWithPasskey, registerPasskey, reauthenticateWithPasskey, passkeyError } from "../src/auth/passkey";

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());
it("未リンク端末と無効ビルドではSMSを残す", () => {
  vi.stubEnv("EXPO_PUBLIC_PASSKEY_ENABLED", ""); expect(supportsPasskey()).toBe(false);
  vi.stubEnv("EXPO_PUBLIC_PASSKEY_ENABLED", "true"); mock.isSupported.mockImplementation(() => { throw new Error("unlinked"); });
  expect(supportsPasskey()).toBe(false);
});
it("OSキャンセル時にはverify APIを呼ばない", async () => {
  mock.apiFetch.mockResolvedValue({ options: { challenge: "challenge" }, challengeToken: "proof" });
  mock.get.mockRejectedValue({ error: "UserCancelled" });
  await expect(loginWithPasskey()).rejects.toEqual({ error: "UserCancelled" });
  expect(mock.apiFetch).toHaveBeenCalledTimes(1);
  expect(passkeyError({ error: "UserCancelled" })).toBe("操作をキャンセルしました");
});
it("ログインはサーバー検証が成功したセッションだけ返す", async () => {
  mock.apiFetch.mockResolvedValueOnce({ options: { challenge: "challenge" }, challengeToken: "proof" }).mockRejectedValueOnce(new Error("Invalid signature"));
  mock.get.mockResolvedValue({ id: "key" });
  await expect(loginWithPasskey()).rejects.toThrow("Invalid signature");
  expect(mock.apiFetch.mock.calls[1][2]).toEqual({ skipAuthRedirect: true });
});
it("登録の両APIに同じ本人確認証明を渡す", async () => {
  mock.apiFetch.mockResolvedValueOnce({ options: { challenge: "challenge" }, challengeToken: "proof" }).mockResolvedValueOnce({ ok: true });
  mock.create.mockResolvedValue({ id: "key" });
  await registerPasskey("recent-grant");
  expect(mock.create).toHaveBeenCalledWith({ challenge: "challenge" });
  for (const [, request] of mock.apiFetch.mock.calls) expect(request.headers).toEqual({ "x-reauth-token": "recent-grant" });
  expect(JSON.parse(mock.apiFetch.mock.calls[1][1].body)).toMatchObject({ response: { id: "key" }, challengeToken: "proof" });
});
it("再本人確認をlogin用verifyへ送らない", async () => {
  mock.apiFetch.mockResolvedValueOnce({ options: {}, challengeToken: "reauth-proof" }).mockResolvedValueOnce({ reauthToken: "grant" });
  mock.get.mockResolvedValue({ id: "key" });
  expect(await reauthenticateWithPasskey()).toEqual({ reauthToken: "grant" });
  expect(mock.apiFetch.mock.calls[1][0]).toBe("/api/auth/reauth/verify");
  expect(JSON.parse(mock.apiFetch.mock.calls[1][1].body).method).toBe("passkey");
});
