// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mock = vi.hoisted(() => ({ rpc: vi.fn(), fieldError: null as string | null }));
vi.mock("@/server/auth", () => ({ requireAuth: async () => ({ driverId: "self" }), isAuthError: (value: unknown) => value instanceof NextResponse }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
vi.mock("@/server/reports/validateFieldWrites", () => ({ validateReportFieldWrites: async () => mock.fieldError }));
vi.mock("@/server/vehicles/reportScope", () => ({ loadReportVehicles: async () => [] }));
vi.mock("@/server/db/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, is: () => q, in: () => q,
      maybeSingle: async () => ({ data: table === "courses" ? { carrier_id: "carrier" } : null, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "units" ? [{ id: uid(2) }] : [{ unit_id: uid(2), field_key: "completed" }], error: null }).then(resolve) };
    return q;
  },
} }));
import { POST } from "./route";
const req = (item: unknown) => new NextRequest("http://localhost/api/reports/course-requests", { method: "POST", body: JSON.stringify({ reportDate: "2026-11-16", expectedRevision: "read-revision", item }) });
const item = () => ({ courseId: uid(1), cycleNo: 2, entries: [{ unitId: uid(2), fieldKey: "completed", valueNum: 23 }] });
beforeEach(() => { mock.rpc.mockReset().mockResolvedValue({ data: "request-id", error: null }); mock.fieldError = null; });
it("本人・会社・便と入力値を固定して申請を保存する", async () => {
  expect((await POST(req(item()))).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("save_report_course_request", expect.objectContaining({ p_org: "org", p_driver: "self", p_course: uid(1), p_cycle: 2 }));
});
it("重複項目と存在しない項目は書き込まない", async () => {
  const value = item(); value.entries.push(value.entries[0]);
  expect((await POST(req(value))).status).toBe(400);
  const invalid = item(); invalid.entries[0].fieldKey = "other";
  expect((await POST(req(invalid))).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("便の設定変更と既にシフトにある申請を拒否する", async () => {
  mock.fieldError = "項目が変更されました";
  expect((await POST(req(item()))).status).toBe(409);
  mock.fieldError = null; mock.rpc.mockResolvedValue({ error: { code: "23514" } });
  expect((await POST(req(item()))).status).toBe(409);
});

it("一括送信と共通の担当コース制限を案内する", async () => {
  const message = "担当コースの設定を確認してください。必要な場合は運営に連絡してください";
  mock.rpc.mockResolvedValue({ error: { code: "23514", message } });
  const response = await POST(req(item()));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: message });
});
