// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// course_rates は org 列を持たない（migration 178 で追加）。2026-09-18 の点検で、
// GET が **絞りを一切持たず全社の単価（売上・支払・利益）を返し**、PATCH が
// course_id だけを条件に他社の単価を書き換えられる状態だったのが見つかった。
// GET は対象UUIDを知る必要すらないため、ここを固定する。
const m = vi.hoisted(() => ({ from: vi.fn(), belongs: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({
  requireAnyPermission: async () => ({ driverId: "actor", orgId: "org-1", capabilities: new Set() }),
  isAuthError: () => false,
}));
vi.mock("@/server/auth/domainCaps", () => ({
  COURSE_BILLING_VIEW_CAPS: [],
  COURSE_BILLING_MANAGE_CAPS: [],
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-1" }));
vi.mock("@/server/db/adminResourceScope", () => ({ belongsToOrg: m.belongs }));

import { GET, PATCH } from "@/app/api/admin/course-rates/route";

const OTHER_COURSE = "99999999-9999-4999-8999-999999999999";

beforeEach(() => vi.clearAllMocks());

describe("他社のコース単価を読めない・書き換えられない", () => {
  it("一覧は自社のコース集合で絞って引く", async () => {
    const seen: { table: string; filter?: [string, unknown] }[] = [];
    m.from.mockImplementation((table: string) => {
      const entry: { table: string; filter?: [string, unknown] } = { table };
      seen.push(entry);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        entry.filter = [c, v];
        return chain;
      };
      chain.in = (c: string, v: unknown) => {
        entry.filter = [c, v];
        return Promise.resolve({ data: [], error: null });
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === "courses" ? [{ id: "own-course" }] : [], error: null });
      return chain;
    });
    const res = await GET(new NextRequest("http://localhost/api/admin/course-rates"));
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.table)).toEqual(["courses", "course_rates"]);
    expect(seen[0].filter).toEqual(["org_id", "org-1"]);
    expect(seen[1].filter).toEqual(["course_id", ["own-course"]]);
  });

  it("自社にコースが無ければ空を返し、単価表を引かない", async () => {
    m.from.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return chain;
    });
    const res = await GET(new NextRequest("http://localhost/api/admin/course-rates"));
    expect(await res.json()).toEqual({ rates: [] });
    expect(m.from).toHaveBeenCalledTimes(1);
  });

  it("他社のコースの単価更新は 404 で止め、DB を触らない", async () => {
    m.belongs.mockResolvedValue(false);
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/course-rates", {
        method: "PATCH",
        body: JSON.stringify({ course_id: OTHER_COURSE, takuhaibin_revenue: 1 }),
      }),
    );
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
    expect(m.belongs).toHaveBeenCalledWith("courses", OTHER_COURSE, "org-1");
  });
});
