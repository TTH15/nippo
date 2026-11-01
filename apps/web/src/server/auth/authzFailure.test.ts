// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ offline: false }));
vi.mock("@/server/db/client", () => ({ supabase: { from: (table: string) => ({ select: () => ({ eq: () => table === "drivers" ? { maybeSingle: async () => mock.offline ? { data: null, error: { code: "offline" } } : { data: { role: "ACCOUNTING", role_id: "restricted-accounting", org_id: "org", works_as_driver: false }, error: null } } : Promise.resolve({ data: [{ capability: "can_view_reports" }], error: null }) }) }) } }));
vi.mock("@/server/auth/index", () => ({ requireAuth: async () => ({ driverId: "self", identityId: "person", orgId: "org", role: "ACCOUNTING", purpose: "admin", tokenVersion: 0 }), isAuthError: (v: unknown) => v instanceof NextResponse }));
import { requirePermission, requireAnyPermission } from "@/server/auth/permissions";
import { resolveGrants } from "@/server/auth/authorize";
beforeEach(() => { mock.offline = false; });
it("正常時も所属権限検索の障害時も剥奪した請求管理権限を戻さない", async () => {
 const request = new NextRequest("http://localhost/api/admin/fixture");
 const denied = await requirePermission(request,"can_manage_billing");
 expect(denied).toBeInstanceOf(NextResponse);
 expect((denied as NextResponse).status).toBe(403);
 mock.offline = true;
 const allowed = await requirePermission(request,"can_manage_billing");
 expect(allowed).toBeInstanceOf(NextResponse);
 expect((allowed as NextResponse).status).toBe(503);
 expect((await requireAnyPermission(request,["can_manage_billing"]) as NextResponse).status).toBe(503);
});
it("scope権限解決も検索障害時は拒否する", async () => {
 expect((await resolveGrants("self","ACCOUNTING")).capabilities.has("can_manage_billing")).toBe(false);
 mock.offline = true;
 await expect(resolveGrants("self","ACCOUNTING")).rejects.toThrow("権限を確認できませんでした");
});
