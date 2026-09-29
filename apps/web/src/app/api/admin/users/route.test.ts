// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ permission: vi.fn(), capability: vi.fn(), from: vi.fn() }));
vi.mock("@/server/auth", () => ({
  requirePermission: h.permission,
  hasCapabilityCached: h.capability,
  isAuthError: (value: unknown) => value instanceof Response,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-a" }));
vi.mock("@/server/db/client", () => ({ supabase: { from: h.from } }));
vi.mock("@/server/kyc/storage", () => ({ signKyc: vi.fn() }));
import { GET } from "./route";

const drivers = [
  { id: "driver-a", identity_id: "identity-a", name: "佐藤", phone: "09000000001" },
  { id: "driver-b", identity_id: "identity-b", name: "田中", phone: "09000000002" },
  { id: "driver-c", identity_id: null, name: "鈴木", phone: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.permission.mockResolvedValue({ driverId: "admin-a" });
  h.capability.mockResolvedValue(false);
});

it("会社の一覧に含まれる本人IDからSMS認証とパスキー登録を各行へ付ける", async () => {
  let driverQueries = 0;
  const identityIn = vi.fn().mockResolvedValue({ data: [
    { id: "identity-a", phone_verified_at: "2026-09-01", face_photo_path: null, license_photo_path: null, license_expiry: null, name_kana: null },
    { id: "identity-b", phone_verified_at: null, face_photo_path: null, license_photo_path: null, license_expiry: null, name_kana: null },
  ], error: null });
  const passkeyIn = vi.fn().mockResolvedValue({ data: [{ identity_id: "identity-b" }], error: null });
  h.from.mockImplementation((table: string) => {
    if (table === "identities") return { select: () => ({ in: identityIn }) };
    if (table === "passkey_credentials") return { select: () => ({ in: passkeyIn }) };
    if (table === "drivers") {
      driverQueries += 1;
      const query = {
        select: () => query,
        eq: () => query,
        in: () => driverQueries === 1 ? query : Promise.resolve({ count: 3 }),
        order: () => query,
        range: async () => ({ data: drivers, error: null }),
      };
      return query;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const response = await GET(new NextRequest("http://localhost/api/admin/users"));
  expect(response.status).toBe(200);
  expect((await response.json()).drivers.map((driver: { phone_verified_at: string | null; has_passkey: boolean }) =>
    [driver.phone_verified_at, driver.has_passkey])).toEqual([
    ["2026-09-01", false],
    [null, true],
    [null, false],
  ]);
  expect(identityIn).toHaveBeenCalledWith("id", ["identity-a", "identity-b"]);
  expect(passkeyIn).toHaveBeenCalledWith("identity_id", ["identity-a", "identity-b"]);
});
