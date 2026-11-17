// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ capabilities: new Set<string>(), from: vi.fn() }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "driver", capabilities: mock.capabilities }),
  isAuthError: (value: unknown) => value instanceof NextResponse,
}));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
import { GET } from "./route";

beforeEach(() => { mock.from.mockReset(); mock.capabilities = new Set(); });

it.each([{ caps: [] }, { caps: ["can_view_sales"] }, { caps: ["can_view_profit"] }])("両方の金額権限がない場合は取引先集計を返さない: %s", async ({ caps }) => {
  mock.capabilities = new Set(caps);
  expect((await GET(new NextRequest("http://localhost/api/admin/counterparties/summary"))).status).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});
