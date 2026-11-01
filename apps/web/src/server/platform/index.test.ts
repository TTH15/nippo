// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireAuth: mock.auth, isAuthError: (value: unknown) => value instanceof Response }));
vi.mock("@/server/db/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mock.read }) }) }) } }));
import { requirePlatformAdmin } from "./index";
const user = { driverId: "member", identityId: "person", orgId: "company", role: "DRIVER", purpose: "admin" };
const request = new NextRequest("http://localhost/api/platform/organizations");
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ ...user });
  mock.read.mockResolvedValue({ data: { identity_id: "person" }, error: null });
});
it("SMS・業務トークンでは運営窓口を開けない", async () => {
  mock.auth.mockResolvedValue({ ...user, purpose: "work" });
  expect(await requirePlatformAdmin(request)).toHaveProperty("status", 401);
  expect(mock.read).not.toHaveBeenCalled();
});
it("短命セッションと独立した運営窓口権限の両方を要求する", async () => {
  expect(await requirePlatformAdmin(request)).toMatchObject({ identityId: "person", user });
  mock.read.mockResolvedValue({ data: null, error: null });
  expect(await requirePlatformAdmin(request)).toHaveProperty("status", 403);
  mock.read.mockResolvedValue({ data: null, error: { message: "offline" } });
  expect(await requirePlatformAdmin(request)).toHaveProperty("status", 503);
});
