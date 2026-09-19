// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// driver_ad_hoc_expenses / driver_fixed_expenses は org 列を持たず（migration 176 で追加）、
// 会社は driver_id 経由でしか決まらない。2026-09-18 時点で、経費まわりの4ルートが
// org を一切見ておらず、他社の報酬の金額を読む・足す・書き換える・消すことができた。
// 金額が直接動くため、ここで「DB を触る前に 404 で止まること」を固定する。
const m = vi.hoisted(() => ({ from: vi.fn(), belongs: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "actor", orgId: "org-1", capabilities: new Set() }),
  isAuthError: () => false,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-1" }));
vi.mock("@/server/db/adminResourceScope", () => ({
  adminMutationError: () => new Response(null, { status: 500 }),
  belongsToOrg: m.belongs,
  isDateOnly: () => true,
  isUuid: () => true,
}));

import { GET as getAdHoc, POST as postAdHoc } from "@/app/api/admin/driver-ad-hoc-expenses/route";
import { PATCH as patchAdHoc, DELETE as delAdHoc } from "@/app/api/admin/driver-ad-hoc-expenses/[id]/route";
import { GET as getFixed, POST as postFixed } from "@/app/api/admin/driver-expenses/route";
import { PATCH as patchFixed, DELETE as delFixed } from "@/app/api/admin/driver-expenses/[id]/route";

const OTHER_DRIVER = "88888888-8888-4888-8888-888888888888";

/** 対象行は見つかるが、そのドライバーは他社、という状態を作る */
function rowOwnedByOther() {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "update", "delete", "insert", "eq", "order"]) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: { driver_id: OTHER_DRIVER }, error: null });
  chain.single = async () => ({ data: null, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.belongs.mockResolvedValue(false);
});

describe("他社ドライバーの臨時経費に触れない", () => {
  it("一覧は 404 で止め、経費を読まない", async () => {
    const res = await getAdHoc(
      new NextRequest(`http://localhost/x?driver_id=${OTHER_DRIVER}&month=2026-09`),
    );
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("追加は 404 で止め、書き込まない", async () => {
    const res = await postAdHoc(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ driver_id: OTHER_DRIVER, month: "2026-09", name: "x", amount: 1000 }),
      }),
    );
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("金額の変更は 404 で止め、更新しない", async () => {
    let updated = false;
    m.from.mockImplementation(() => {
      const chain = rowOwnedByOther();
      chain.update = () => {
        updated = true;
        return chain;
      };
      return chain;
    });
    const res = await patchAdHoc(
      new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ amount: 9999 }) }),
      { params: Promise.resolve({ id: "row-1" }) },
    );
    expect(res.status).toBe(404);
    expect(updated).toBe(false);
    expect(m.belongs).toHaveBeenCalledWith("drivers", OTHER_DRIVER, "org-1");
  });

  it("削除は 404 で止め、消さない", async () => {
    let deleted = false;
    m.from.mockImplementation(() => {
      const chain = rowOwnedByOther();
      chain.delete = () => {
        deleted = true;
        return chain;
      };
      return chain;
    });
    const res = await delAdHoc(new NextRequest("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(404);
    expect(deleted).toBe(false);
  });
});

describe("他社ドライバーの固定控除に触れない", () => {
  it("一覧は 404 で止め、経費を読まない", async () => {
    const res = await getFixed(new NextRequest(`http://localhost/x?driver_id=${OTHER_DRIVER}`));
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("追加は 404 で止め、書き込まない", async () => {
    const res = await postFixed(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ driver_id: OTHER_DRIVER, name: "x", amount: 3000 }),
      }),
    );
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("金額の変更と削除は 404 で止める", async () => {
    let touched = false;
    m.from.mockImplementation(() => {
      const chain = rowOwnedByOther();
      chain.update = chain.delete = () => {
        touched = true;
        return chain;
      };
      return chain;
    });
    const patched = await patchFixed(
      new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ amount: 1 }) }),
      { params: Promise.resolve({ id: "row-1" }) },
    );
    const deleted = await delFixed(new NextRequest("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(touched).toBe(false);
  });
});
