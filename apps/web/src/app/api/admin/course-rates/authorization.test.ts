// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ capabilities: new Set<string>(), from: vi.fn() }));
vi.mock("@/server/auth", () => ({
  requireAnyPermission: async () => ({ driverId: "driver", capabilities: mock.capabilities }),
  isAuthError: (value: unknown) => value instanceof NextResponse,
}));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
import { GET, PATCH } from "./route";

beforeEach(() => { mock.from.mockReset(); mock.capabilities = new Set(); });

it.each([{ caps: [] }, { caps: ["can_view_sales"] }, { caps: ["can_view_profit"] }])("売上と利益が両方ない場合は単価を返さない: %s", async ({ caps }) => {
  mock.capabilities = new Set(caps);
  const response = await GET(new NextRequest("http://localhost/api/admin/course-rates"));
  expect(response.status).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});

it("片方の権限だけでは単価を更新しない", async () => {
  mock.capabilities = new Set(["can_view_sales"]);
  const response = await PATCH(new NextRequest("http://localhost/api/admin/course-rates", { method: "PATCH", body: "{}" }));
  expect(response.status).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});
