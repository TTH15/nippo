// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ shifts: [] as any[], existing: [] as any[], writes: vi.fn(), sync: vi.fn(), error: null as any, fieldError: null as string | null }));
vi.mock("@/server/auth", () => ({ requireAuth: async () => ({ driverId: "self", orgId: "org" }), isAuthError: () => false }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
vi.mock("@/server/reports/validateFieldWrites", () => ({ validateReportFieldWrites: async () => mocks.fieldError }));
vi.mock("@/server/reports/entries", () => ({ syncReportEntries: (...args: any[]) => mocks.sync(...args) }));
vi.mock("@/server/reports/parking", () => ({ parseParkingReport: vi.fn(), saveParkingReport: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from(table: string) {
  let writing = false;
  const query: any = {
    select: () => query, eq: () => query, in: () => query, is: () => query,
    update: (value: unknown) => { writing = true; mocks.writes(value); return query; },
    insert: (value: unknown) => { writing = true; mocks.writes(value); return query; },
    single: async () => ({ data: { id: "created" }, error: mocks.error }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: writing ? null : table === "shifts" ? mocks.shifts : table === "report_entries" ? [] : mocks.existing, error: writing ? mocks.error : null }).then(resolve),
  };
  return query;
} } }));
import { POST } from "./route";
const submit = (cycleNo = 0) => POST(new NextRequest("http://localhost/api/reports/v2", { method: "POST", body: JSON.stringify({ reportDate: "2026-10-16", items: [{ courseId: "course", cycleNo, entries: [] }] }) }));

beforeEach(() => { vi.clearAllMocks(); mocks.shifts = []; mocks.existing = [{ id: "previous", course_id: "course", cycle_no: 0, vehicle_id: null }]; mocks.error = null; mocks.fieldError = null; });
it("提出済みでも解除済みコースへの再送を拒否する", async () => {
  const response = await submit();
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("シフトにない");
  expect(mocks.writes).not.toHaveBeenCalled();
});
it("同じコースでも変更前の便への再送を拒否する", async () => {
  mocks.shifts = [{ course_id: "course", cycle_no: 2 }];
  expect((await submit(1)).status).toBe(400);
  expect(mocks.writes).not.toHaveBeenCalled();
});
it("現在のシフトに一致すれば提出済み日報を更新する", async () => {
  mocks.shifts = [{ course_id: "course", cycle_no: 0 }];
  expect((await submit()).status).toBe(200);
  expect(mocks.writes).toHaveBeenCalledOnce();
  expect(mocks.sync).toHaveBeenCalledOnce();
});
it("確認後にシフトが変わったDBエラーは再確認可能な409で返す", async () => {
  mocks.shifts = [{ course_id: "course", cycle_no: 0 }];
  mocks.error = { code: "23514", message: "シフトが変更されています。" };
  const response = await submit();
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("最新のシフト");
  expect(mocks.sync).not.toHaveBeenCalled();
});

it("項目の不整合はヘッダや承認を変更する前に止める", async () => {
  mocks.shifts = [{ course_id: "course", cycle_no: 1 }]; mocks.fieldError = "便の設定と異なる項目があります。";
  expect((await submit(1)).status).toBe(409); expect(mocks.writes).not.toHaveBeenCalled();
});
it("追加したC2だけを保存し、変更のない承認済みC1には書き込まない", async () => {
  mocks.shifts = [{ course_id: "course", cycle_no: 1 }, { course_id: "course", cycle_no: 2 }];
  mocks.existing = [{ id: "approved-c1", course_id: "course", cycle_no: 1, approved_at: "approved", vehicle_id: null, meter_value: null }];
  const response = await POST(new NextRequest("http://localhost/api/reports/v2", { method: "POST", body: JSON.stringify({ reportDate: "2026-10-16", items: [1,2].map(cycleNo => ({ courseId: "course", cycleNo, entries: [] })) }) }));
  expect(response.status).toBe(200); expect(mocks.writes).toHaveBeenCalledOnce();
  expect(mocks.writes.mock.calls[0][0].cycle_no).toBe(2);
});
it("旧全体日報はコースの割当が残る場合だけ更新できる", async () => {
  mocks.shifts = [{ course_id: "course", cycle_no: 1 }, { course_id: "course", cycle_no: 2 }];
  expect((await submit(0)).status).toBe(200);
});
