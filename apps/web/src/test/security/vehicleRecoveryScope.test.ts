// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ from: vi.fn(), belongs: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "actor", orgId: "org-a" }),
  isAuthError: () => false,
}));
vi.mock("@/server/db/adminResourceScope", () => ({
  belongsToOrg: m.belongs,
  isUuid: () => true,
}));

import { POST as addEntry, DELETE as removeEntry } from "@/app/api/admin/vehicles/[id]/recovery-entries/route";
import { PUT as setCollected } from "@/app/api/admin/vehicles/[id]/recovery-collected/route";

const otherVehicle = "88888888-8888-4888-8888-888888888888";
const params = { params: Promise.resolve({ id: otherVehicle }) };

beforeEach(() => {
  vi.clearAllMocks();
  m.belongs.mockResolvedValue(false);
});

describe("他社車両の回収額は変更できない", () => {
  it("手動回収行の追加・削除をDB書き込み前に拒否する", async () => {
    const added = await addEntry(new NextRequest("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ ym: "2026-10", lease: 1000 }),
    }), params);
    const removed = await removeEntry(new NextRequest("http://localhost/x?entry_id=99999999-9999-4999-8999-999999999999", {
      method: "DELETE",
    }), params);
    expect(added.status).toBe(404);
    expect(removed.status).toBe(404);
    expect(m.belongs).toHaveBeenCalledWith("vehicles", otherVehicle, "org-a");
    expect(m.from).not.toHaveBeenCalled();
  });

  it("回収済み印の更新をDB書き込み前に拒否する", async () => {
    const response = await setCollected(new NextRequest("http://localhost/x", {
      method: "PUT",
      body: JSON.stringify({ month: 1, collected: true }),
    }), params);
    expect(response.status).toBe(404);
    expect(m.belongs).toHaveBeenCalledWith("vehicles", otherVehicle, "org-a");
    expect(m.from).not.toHaveBeenCalled();
  });
});
