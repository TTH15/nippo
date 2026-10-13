// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { bankCleanupRow, bankStorageFields, type BankCleanupDriver } from "@/lib/bankCleanup";
const h = vi.hoisted(() => ({ permission: vi.fn(), capability: vi.fn(), from: vi.fn() }));
vi.mock("@/server/auth", () => ({ requirePermission: h.permission, hasCapabilityCached: h.capability, isAuthError: (v: unknown) => v instanceof Response }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-a" }));
vi.mock("@/server/db/client", () => ({ supabase: { from: h.from } }));
import { GET, POST } from "./route";
const driver: BankCleanupDriver = { id: "driver-a", name: "見本", driver_code: "TST1", bank_name: "見本銀行　中央支店", bank_no: "普通 01234567", bank_holder: "ミホン", bank_branch_name: null, bank_account_type: null, bank_account_type_other: null };
function mockDB(row: BankCleanupDriver | null = driver, saved: { id: string } | null = { id: driver.id }) {
 const reads = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: row ? [row] : [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
 const writes = { update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: saved, error: null }) };
 for (const key of ["select", "eq", "order"] as const) reads[key].mockReturnValue(reads);
 for (const key of ["update", "eq", "is", "select"] as const) writes[key].mockReturnValue(writes);
 h.from.mockReturnValueOnce(reads).mockReturnValue(writes);
 return { reads, writes };
}
const body = () => ({ id: driver.id, before: Object.fromEntries(bankStorageFields.map(key => [key, driver[key] ?? null])), candidate: bankCleanupRow(driver)!.candidate });
const req = (value: unknown) => new NextRequest("http://localhost/api/admin/bank-cleanup", { method: "POST", body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); h.permission.mockResolvedValue({ driverId: "admin-a" }); h.capability.mockResolvedValue(true); });
it("未認証・口座閲覧不可はDBを読まない", async () => {
 h.permission.mockResolvedValueOnce(NextResponse.json({}, { status: 401 })); expect((await GET(new NextRequest("http://localhost/api/admin/bank-cleanup"))).status).toBe(401);
 h.capability.mockResolvedValue(false); expect((await POST(req(body()))).status).toBe(403); expect(h.from).not.toHaveBeenCalled();
});
it("一覧は所属会社・ドライバーに限定し100件ずつ返す", async () => {
 const { reads } = mockDB(); const response = await GET(new NextRequest("http://localhost/api/admin/bank-cleanup?cursor=100"));
 expect(response.status).toBe(200); expect(reads.eq).toHaveBeenCalledWith("org_id", "org-a"); expect(reads.eq).toHaveBeenCalledWith("works_as_driver", true); expect(reads.range).toHaveBeenCalledWith(100, 199); expect((await response.json()).rows).toHaveLength(1);
});
it("保存は権限を求め、全6項目の元値をCASで比較する", async () => {
 const { writes } = mockDB(); expect((await POST(req(body()))).status).toBe(200);
 expect(h.permission).toHaveBeenCalledWith(expect.anything(), "can_manage_members"); expect(writes.update).toHaveBeenCalledWith(body().candidate);
 expect(writes.eq).toHaveBeenCalledWith("org_id", "org-a"); expect(writes.eq).toHaveBeenCalledWith("id", driver.id);
 for (const key of bankStorageFields) if (driver[key] === null) expect(writes.is).toHaveBeenCalledWith(key, null); else expect(writes.eq).toHaveBeenCalledWith(key, driver[key]);
});
it("他社・対象外のIDは更新しない", async () => { const { writes } = mockDB(null); expect((await POST(req(body()))).status).toBe(404); expect(writes.update).not.toHaveBeenCalled(); });
it("元値変更・候補改ざん・曖昧データを拒否", async () => {
 for (const value of [{ ...body(), before: { ...body().before, bank_no: "9999" } }, { ...body(), candidate: { ...body().candidate, bank_no: "9999" } }]) {
  const { writes } = mockDB(); expect((await POST(req(value))).status).toBe(409); expect(writes.update).not.toHaveBeenCalled();
 }
 const ambiguous = { ...driver, bank_name: "見本 銀行" }; const { writes } = mockDB(ambiguous); expect((await POST(req(body()))).status).toBe(409); expect(writes.update).not.toHaveBeenCalled();
});
it("確認後とUPDATE間の競合も成功扱いにしない", async () => { mockDB(driver, null); expect((await POST(req(body()))).status).toBe(409); });
it("DB保存失敗は500、項目欠落は400", async () => {
 const { writes } = mockDB(); writes.maybeSingle.mockResolvedValue({ data: null, error: { message: "failed" } } as never); expect((await POST(req(body()))).status).toBe(500);
 expect((await POST(req({ id: driver.id }))).status).toBe(400);
});
