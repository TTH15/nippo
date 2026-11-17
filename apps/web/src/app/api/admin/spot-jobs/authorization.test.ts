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
import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";
import { serializeSpotJob } from "@/server/spotJobs";

beforeEach(() => { mock.from.mockReset(); mock.capabilities = new Set(); });

it("売上のみの一覧応答に参加者の日当を含めない", async () => {
  mock.capabilities = new Set(["can_view_sales"]);
  const rows: Record<string, unknown[]> = {
    spot_jobs: [{ id: "job", title: "案件", job_date: "2026-11-16", meeting_place: null, meeting_time: null,
      end_time: null, client_name: null, billing_amount: 10000, note: null, status: "planned", created_at: "" }],
    drivers: [],
    spot_job_members: [{ id: "member", job_id: "job", driver_id: "driver", display_name: null, pay_amount: 7000 }],
  };
  mock.from.mockImplementation((table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lte", "order", "or", "in"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows[table], error: null }));
    return query;
  });
  const response = await GET(new NextRequest("http://localhost/api/admin/spot-jobs?month=2026-11"));
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.jobs[0].billingAmount).toBe(10000);
  expect(result.jobs[0].members[0].payAmount).toBeNull();
  expect(JSON.stringify(result)).not.toContain("7000");
});

it.each([{ caps: [] }, { caps: ["can_view_sales"] }, { caps: ["can_view_profit"] }])("両方の権限がない場合、金額を含む案件の保存を拒否する: %s", async ({ caps }) => {
  mock.capabilities = new Set(caps);
  const create = await POST(new NextRequest("http://localhost/api/admin/spot-jobs", { method: "POST", body: JSON.stringify({billingAmount: 100}) }));
  const edit = await PATCH(new NextRequest("http://localhost/api/admin/spot-jobs/id", { method: "PATCH", body: JSON.stringify({billingAmount: 100}) }), { params: Promise.resolve({ id: "id" }) });
  expect([create.status, edit.status]).toEqual([403, 403]);
  expect(mock.from).not.toHaveBeenCalled();
});

it.each([
  { sales: false, profit: false, billing: null, pay: null },
  { sales: true, profit: false, billing: 10000, pay: null },
  { sales: false, profit: true, billing: null, pay: null },
  { sales: true, profit: true, billing: 10000, pay: 7000 },
])("請求額と日当の応答を閲覧権限に合わせる: %s", ({ sales, profit, billing, pay }) => {
  const result = serializeSpotJob({ id: "job", title: "案件", job_date: "2026-11-16", meeting_place: null,
    meeting_time: null, end_time: null, client_name: null, billing_amount: 10000, note: null,
    status: "planned", created_at: "" }, [{ id: "member", job_id: "job", driver_id: "driver", display_name: null, pay_amount: 7000 }], { sales, profit });
  expect(result.billingAmount).toBe(billing);
  expect(result.members[0].payAmount).toBe(pay);
});
