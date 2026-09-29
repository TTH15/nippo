// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ capabilities: vi.fn(), signToken: vi.fn() }));
vi.mock("@/server/auth/permissions", () => ({ resolveCapabilities: mock.capabilities }));
vi.mock("@/server/auth/jwt", () => ({ signToken: mock.signToken }));
vi.mock("@/server/db/client", () => ({ supabase: {} }));

import { issueAdminSession, type ActiveDriverRow } from "./identity";

const driver: ActiveDriverRow = {
  id: "driver-1", name: "試験者", role: "DRIVER", company_code: "AAA",
  office_code: null, driver_code: null, identity_id: "person-1", org_id: "org-1",
  status: "active", token_version: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.signToken.mockResolvedValue("short-admin-token");
});

describe("運営用セッションの発行", () => {
  it("同じ所属に運営権限があれば8時間用のadmin目的で発行する", async () => {
    mock.capabilities.mockResolvedValue(new Set(["can_view_billing"]));
    expect(await issueAdminSession(driver)).toBe("short-admin-token");
    expect(mock.signToken).toHaveBeenCalledWith(expect.objectContaining({
      driverId: "driver-1", identityId: "person-1", orgId: "org-1", tokenVersion: 3, purpose: "admin",
    }));
  });

  it("運営権限がなければ発行しない", async () => {
    mock.capabilities.mockResolvedValue(new Set());
    expect(await issueAdminSession(driver)).toBeNull();
    expect(mock.signToken).not.toHaveBeenCalled();
  });

  it("本人と会社の結び付きがなければ発行しない", async () => {
    expect(await issueAdminSession({ ...driver, identity_id: null })).toBeNull();
    expect(await issueAdminSession({ ...driver, org_id: null })).toBeNull();
    expect(mock.signToken).not.toHaveBeenCalled();
  });
});
