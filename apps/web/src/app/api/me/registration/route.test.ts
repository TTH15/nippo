// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), eq: vi.fn(), count: 0, error: null as unknown }));
vi.mock("@/server/auth", () => ({ requireAuth: mock.auth, isAuthError: (value: unknown) => value instanceof NextResponse }));
vi.mock("@/server/identity", () => ({ resolveIdentityId: async () => "self-identity" }));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from } }));
import { GET } from "./route";
const req = () => new NextRequest("http://localhost/api/me/registration");
beforeEach(() => {
  vi.clearAllMocks(); mock.count = 0; mock.error = null;
  mock.auth.mockResolvedValue({ driverId: "self-driver", identityId: "self-identity" });
  mock.from.mockImplementation((table) => {
    const query = { select: () => query, eq: (key: string, value: string) => { mock.eq(table, key, value); return query; },
      single: async () => ({ data: {} }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: mock.count, error: mock.error }).then(resolve),
    };
    return query;
  });
});
describe("登録再開時のPasskey状態", () => {
  it.each([0, 1])("本人の資格情報%s件を未登録/登録済みに反映する", async (count) => {
    mock.count = count;
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPasskey).toBe(count > 0);
    expect(mock.eq).toHaveBeenCalledWith("passkey_credentials", "identity_id", "self-identity");
    expect(body).not.toHaveProperty("credentials");
  });
  it("状態取得失敗を未登録と誤認しない", async () => {
    mock.error = { message: "offline" };
    expect((await GET(req())).status).toBe(503);
  });
  it("未認証では状態を返さない", async () => {
    mock.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
    expect(mock.from).not.toHaveBeenCalled();
  });
});
