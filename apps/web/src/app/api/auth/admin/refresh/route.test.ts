// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({ auth: vi.fn(), issue: vi.fn(), driver: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireAuth: mock.auth, isAuthError: (value: unknown) => value instanceof Response }));
vi.mock("@/server/identity", () => ({ issueAdminSession: mock.issue }));
vi.mock("@/server/db/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ single: mock.driver }) }) }) } }));

import { signAdminRenew } from "@/server/auth/adminRenew";
import { POST } from "./route";

const claims = { driverId: "driver-a", identityId: "person-a", orgId: "org-a", tokenVersion: 3 };
const request = (cookie?: string, origin = "http://localhost") => new NextRequest("http://localhost/api/auth/admin/refresh", {
  method: "POST", headers: { origin, authorization: "Bearer work-token", ...(cookie ? { cookie: `nippo_admin_renew=${cookie}` } : {}) },
});

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "admin-renew-test-secret");
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ driverId: "driver-a", identityId: "person-a", orgId: "org-a", tokenVersion: 3, purpose: "work" });
  mock.driver.mockResolvedValue({ data: { id: "driver-a", identity_id: "person-a", org_id: "org-a", token_version: 3, status: "active" }, error: null });
  mock.issue.mockResolvedValue("fresh-admin-token");
});

describe("運営セッションの自動更新", () => {
  it("業務トークンとHttpOnly Cookieの本人・所属が一致した場合だけ更新する", async () => {
    const response = await POST(request(await signAdminRenew(claims)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adminToken: "fresh-admin-token" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("Cookieなし・他人のCookie・異なるサイトからの要求は拒否する", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request(await signAdminRenew({ ...claims, driverId: "driver-b" })))).status).toBe(401);
    expect((await POST(request(await signAdminRenew(claims), "https://other.example"))).status).toBe(403);
    expect(mock.issue).not.toHaveBeenCalled();
  });

  it("SMSの業務トークンだけでは更新できず、権限剥奪も反映する", async () => {
    mock.auth.mockResolvedValueOnce({ driverId: "driver-a", identityId: "person-a", orgId: "org-a", tokenVersion: 3, purpose: "admin" });
    expect((await POST(request(await signAdminRenew(claims)))).status).toBe(401);
    mock.issue.mockResolvedValue(null);
    expect((await POST(request(await signAdminRenew(claims)))).status).toBe(403);
  });
});
