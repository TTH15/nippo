// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ permission: vi.fn(), from: vi.fn(), view: false, filters: [] as unknown[][], update: {} as Record<string, unknown> }));
vi.mock("@/server/auth", () => ({ requirePermission: m.permission, isAuthError: (v: unknown) => v instanceof NextResponse, getCapabilities: async () => new Set(m.view ? ["can_view_bank_accounts"] : []) }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "own-org" }));
vi.mock("@/server/db/adminResourceScope", () => ({ coursesBelongToOrg: async () => true }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
import { GET, PUT } from "./route";
const params = { params: Promise.resolve({ id: "self-driver" }) };
const bank = { bankName: "見本銀行", bankBranch: "中央支店", bankNo: "01234567", bankHolder: "ミホン", bankType: "other", bankTypeOther: "別段" };
const request = (body = bank) => new NextRequest("http://localhost/api/admin/users/self-driver", { method: "PUT", body: JSON.stringify(body) });
beforeEach(() => {
 m.view=false; m.filters=[]; m.update={}; m.from.mockReset(); m.permission.mockReset().mockResolvedValue({ driverId: "operator", companyCode: "TEST" });
 m.from.mockImplementation((table: string) => {
  const q = { select: () => q, eq: (k: string, v: unknown) => { m.filters.push([table,k,v]); return q; },
   single: async () => ({ data: { id: "self-driver", company_code: "TEST", role_id: "driver-role", identity_id: null, bank_name: "見本銀行", bank_no: "01234567", bank_holder: "ミホン", bank_branch_name: "中央支店", bank_account_type: "other", bank_account_type_other: "別段" }, error:null }),
   maybeSingle: async () => ({ data: table === "roles" ? { id: "admin-role" } : null, error:null }), update: (value: Record<string, unknown>) => { m.update=value; return q; },
   then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data:null,error:null }).then(resolve) };
  return q;
 });
});
it.each([false,true])("新しい口座項目も閲覧権限%sに従い、本人所属行だけを返す", async view => {
 m.view=view; const body=await (await GET(new NextRequest("http://localhost/api/admin/users/self-driver"), params)).json();
 expect(body.driver.bank_branch_name).toBe(view ? "中央支店" : null);
 expect(body.driver.bank_account_type).toBe(view ? "other" : null);
 expect(body.driver.bank_account_type_other).toBe(view ? "別段" : null);
 expect(m.filters).toContainEqual(["drivers","org_id","own-org"]);
});
it("PUTは独立項目を本人所属に保存し、具体名不足では書き込みしない", async () => {
 expect((await PUT(request({ ...bank, bankTypeOther: "" }),params)).status).toBe(400); expect(m.from).not.toHaveBeenCalled();
 expect((await PUT(request(),params)).status).toBe(200);
 expect(m.update).toMatchObject({ bank_name: "見本銀行", bank_no: "01234567", bank_branch_name: "中央支店", bank_account_type: "other", bank_account_type_other: "別段" });
 expect(m.filters).toContainEqual(["drivers","org_id","own-org"]);
});
it("権限のない更新は口座を読み書きしない", async () => {
 m.permission.mockResolvedValue(NextResponse.json({ error:"Forbidden" },{status:403}));
 expect((await PUT(request(),params)).status).toBe(403); expect(m.from).not.toHaveBeenCalled();
});
