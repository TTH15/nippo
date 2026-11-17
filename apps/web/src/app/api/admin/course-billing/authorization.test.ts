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
import { GET, PUT } from "./route";

beforeEach(() => { mock.from.mockReset(); mock.capabilities = new Set(); });

it.each([{ caps: [] }, { caps: ["can_view_sales"] }, { caps: ["can_view_profit"] }])("単価から売上や利益を推測できない: %s", async ({ caps }) => {
  mock.capabilities = new Set(caps);
  expect((await GET(new NextRequest("http://localhost/api/admin/course-billing?course_id=course"))).status).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});

it("金額権限が不足する場合は単価を更新しない", async () => {
  mock.capabilities = new Set(["can_view_sales"]);
  expect((await PUT(new NextRequest("http://localhost/api/admin/course-billing", { method: "PUT", body: "{}" }))).status).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});
