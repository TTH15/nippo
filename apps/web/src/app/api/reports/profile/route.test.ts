// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ from: vi.fn(), auth: vi.fn(), hash: vi.fn(), eq: vi.fn(), not: vi.fn(), update: vi.fn(), result: { data: null as null | { id: string }, error: null as unknown } }));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/server/auth", () => ({ requireAuth: mock.auth, isAuthError: (value: unknown) => value instanceof NextResponse }));
vi.mock("@/server/identity", () => ({ resolveIdentityId: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: mock.hash } }));
import { GET, PATCH } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ driverId: "self", orgId: "own-company" });
  mock.hash.mockResolvedValue("new-hash");
  mock.result = { data: null, error: null };
  const query = { update: mock.update, eq: mock.eq, not: mock.not, select: () => query, maybeSingle: async () => mock.result };
  for (const fn of [mock.update, mock.eq, mock.not]) fn.mockReturnValue(query);
  mock.from.mockReturnValue(query);
});
const request = (body: unknown = { newPin: "123456", confirmPin: "123456", driverId: "someone-else" }) =>
  new NextRequest("http://localhost/api/reports/profile", { method: "PATCH", body: JSON.stringify(body) });
describe("既存PINだけの変更", () => {
  it.each([null, "legacy-hash"])("プロフィールはPINの有無だけを返しハッシュを公開しない（%s）", async (pinHash) => {
    mock.from.mockImplementation((table) => {
      const query = {
        select: () => query,
        eq: mock.eq.mockImplementation(() => query),
        single: async () => ({ data: { name: "見本", pin_hash: pinHash }, error: null }),
        order: async () => ({ data: [] }),
      };
      expect(["drivers", "driver_identities"]).toContain(table);
      return query;
    });
    const res = await GET(new NextRequest("http://localhost/api/reports/profile"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canChangePin).toBe(false);
    expect(body).not.toHaveProperty("pin_hash");
    expect(JSON.stringify(body)).not.toContain("legacy-hash");
    expect(mock.eq).toHaveBeenCalledWith("id", "self");
  });
  it("旧PINの有無にかかわらず作成・変更をDB操作前に拒否する", async () => {
    expect((await PATCH(request())).status).toBe(410);
    expect(mock.from).not.toHaveBeenCalled(); expect(mock.hash).not.toHaveBeenCalled();
  });
  it("未認証ではDBを書き換えない", async () => {
    mock.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await PATCH(request())).status).toBe(401);
    expect(mock.from).not.toHaveBeenCalled();
  });
});
