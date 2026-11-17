import { describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ roleId: "role-1" as string | null, role: "DRIVER", individual: [] as string[], grantError: false }));

vi.mock("@/server/db/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => table === "drivers"
          ? { maybeSingle: async () => ({ data: { role: mock.role, role_id: mock.roleId, works_as_driver: true } }) }
          : table === "member_capability_grants"
            ? Promise.resolve({ data: mock.grantError ? null : mock.individual.map(capability => ({ capability })), error: mock.grantError ? { code: "offline" } : null })
            : Promise.resolve({ data: [{ capability: "can_manage_org_settings" }] }),
      }),
    }),
  },
}));
vi.mock("./index", () => ({ requireAuth: vi.fn(), isAuthError: vi.fn() }));

import { resolveGrants } from "./authorize";

describe("resolveGrants", () => {
  it("DBロールの上位権限から領域別権限を展開する", async () => {
    mock.roleId = "role-1";
    mock.role = "DRIVER";
    const grants = await resolveGrants("driver-1");
    expect(grants.capabilities.has("can_manage_courses")).toBe(true);
    expect(grants.capabilities.has("can_manage_record_forms")).toBe(true);
    expect(grants.capabilities.has("can_access_records")).toBe(true);
    expect(grants.ownPermissions.has("own_manage_shift_requests")).toBe(true);
  });

  it("旧ロールへのフォールバックでも管理者の権限を展開する", async () => {
    mock.roleId = null;
    mock.role = "ADMIN";
    const grants = await resolveGrants("driver-1", "ADMIN");
    expect(grants.capabilities.has("can_manage_courses")).toBe(true);
    expect(grants.capabilities.has("can_access_records")).toBe(true);
  });

  it("個人の追加を役割と合算し、削除と取得失敗を反映する", async () => {
    mock.roleId = "role-1";
    mock.individual = ["can_view_sales"];
    expect((await resolveGrants("driver-1")).capabilities.has("can_view_sales")).toBe(true);
    mock.individual = ["can_view_profit"];
    expect((await resolveGrants("driver-1")).capabilities.has("can_view_profit")).toBe(false);
    mock.individual = [];
    expect((await resolveGrants("driver-1")).capabilities.has("can_view_sales")).toBe(false);
    mock.grantError = true;
    await expect(resolveGrants("driver-1")).rejects.toThrow();
    mock.grantError = false;
  });
});
