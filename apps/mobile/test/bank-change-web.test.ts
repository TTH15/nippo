import { afterEach, expect, it, vi } from "vitest";
const open = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("react-native", () => ({ Linking: { openURL: open } }));
import { bankChangeWebUrl, openBankChangeWeb } from "../src/bankChangeWeb";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); open.mockClear(); });
it("口座変更は認証情報を付けず固定パスのWebを開く", async () => {
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://example.com/api?token=secret");
  expect(bankChangeWebUrl()).toBe("https://example.com/account/bank-change");
  await openBankChangeWeb(); expect(open).toHaveBeenCalledWith("https://example.com/account/bank-change");
});
it("本番はHTTPS以外を拒否する", () => {
  vi.stubGlobal("__DEV__", false);
  expect(() => bankChangeWebUrl("http://example.com")).toThrow();
  expect(() => bankChangeWebUrl("javascript:alert(1)")).toThrow();
});
