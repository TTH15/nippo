import { expect, it } from "vitest";
import { BANK_CHANGE_PATH, BANK_CHANGE_LOGIN_PATH, bankChangeUnauthorizedPath } from "@repo/core/logic/bankChange";
it("同時の認証切れがログインURLを再処理しても口座変更への戻り先を保持する", () => {
  const first = bankChangeUnauthorizedPath(BANK_CHANGE_PATH);
  const redirected = new URL(first, "https://example.com");
  expect(bankChangeUnauthorizedPath(redirected.pathname, redirected.searchParams.get("returnTo"))).toBe(first);
  expect(first).toBe(BANK_CHANGE_LOGIN_PATH);
});
it("別のURLへの戻り先は採用しない", () => {
  expect(bankChangeUnauthorizedPath("/login", "https://example.com")).toBe("/login");
  expect(bankChangeUnauthorizedPath("/submit", BANK_CHANGE_PATH)).toBe("/login");
});
