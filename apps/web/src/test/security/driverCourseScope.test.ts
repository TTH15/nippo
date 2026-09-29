// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), in: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "actor", orgId: "org-1", companyCode: "ACE" }),
  isAuthError: () => false,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-1" }));

import { coursesBelongToOrg } from "@/server/db/adminResourceScope";
import { POST as createDriver } from "@/app/api/admin/users/route";
import { PUT as updateDriver } from "@/app/api/admin/users/[id]/route";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function courseQuery(rows: string[]) {
  m.in.mockResolvedValue({ data: rows.map((id) => ({ id })), error: null });
  m.eq.mockReturnValue({ in: m.in });
  m.from.mockImplementation((table: string) => {
    if (table !== "courses") throw new Error(`Unexpected access to ${table}`);
    return { select: () => ({ eq: m.eq }) };
  });
}

beforeEach(() => vi.clearAllMocks());

describe("担当コースの会社境界", () => {
  it("重複をまとめて自社の全IDを確認する", async () => {
    courseQuery([OWN]);
    expect(await coursesBelongToOrg([[OWN, OWN], []], "org-1")).toBe(true);
    expect(m.eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(m.in).toHaveBeenCalledWith("id", [OWN]);
  });

  it("作成では別会社のIDが混ざるとドライバー・勤務区分を作らない", async () => {
    courseQuery([OWN]);
    const res = await createDriver(new NextRequest("http://localhost/api/admin/users", {
      method: "POST", body: JSON.stringify({ name: "架空 太郎", officeCode: "123456", driverCode: "ACE123456",
        courseIds: [OWN], courseIds2: [OTHER] }),
    }));
    expect(res.status).toBe(404);
    expect(m.from).toHaveBeenCalledTimes(1);
    expect(m.in).toHaveBeenCalledWith("id", [OWN, OTHER]);
  });

  it("編集では2つ目の勤務区分の別会社IDが混ざると既存行を変更しない", async () => {
    courseQuery([OWN]);
    const res = await updateDriver(new NextRequest("http://localhost/api/admin/users/driver-1", {
      method: "PUT", body: JSON.stringify({ identities: [
        { slot: 1, officeCode: "123456", driverNumber: "123456", courseIds: [OWN] },
        { slot: 2, officeCode: "123456", driverNumber: "234567", courseIds: [OTHER] },
      ] }),
    }), { params: Promise.resolve({ id: "driver-1" }) });
    expect(res.status).toBe(404);
    expect(m.from).toHaveBeenCalledTimes(1);
    expect(m.in).toHaveBeenCalledWith("id", [OWN, OTHER]);
  });
});
