// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
afterEach(() => vi.unstubAllEnvs());
it("管理画面のnonceは毎回変わり、Next描画側とレスポンス側で一致する", () => {
  vi.stubEnv("NODE_ENV", "production");
  const request = new NextRequest("https://hakotora.jp/admin/account", { headers: { "Content-Security-Policy": "script-src 'unsafe-inline'" } });
  const first = proxy(request); const second = proxy(request);
  const csp = first.headers.get("Content-Security-Policy")!;
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("'strict-dynamic'"); expect(csp).not.toContain("'unsafe-inline'"); expect(csp).not.toContain("'unsafe-eval'");
  expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  expect(second.headers.get("Content-Security-Policy")).not.toBe(csp);
  expect(first.headers.get("Cache-Control")).toBe("private, no-store");
});
