// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ from: vi.fn(), compare: vi.fn(), sign: vi.fn(), caps: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("bcryptjs", () => ({ default: { compare: m.compare } }));
vi.mock("@/server/auth", () => ({ signToken: m.sign, resolveCapabilities: m.caps }));
vi.mock("@/config/companies", () => ({ getCompany: () => ({ code: "TST" }) }));
import { POST } from "./route";
const req = (body: object) => new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());
it("旧PINログインはDB検索・比較・セッション発行前に410になる", async () => {
  expect((await POST(req({ loginType: "driver", driverCode: "TST123456", pin: "123456" }))).status).toBe(410);
  expect(m.from).not.toHaveBeenCalled(); expect(m.compare).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
});
it("運営パスワードは別経路として維持する", async () => {
  const q = { select: () => q, eq: () => q, single: async () => ({ data: { id: "admin", role: "ADMIN", status: "active", pin_hash: "admin-password-hash", company_code: "TST" }, error: null }) };
  m.from.mockReturnValue(q); m.compare.mockResolvedValue(true); m.caps.mockResolvedValue(new Set(["can_manage_members"])); m.sign.mockResolvedValue("session");
  expect((await POST(req({ loginType: "admin", adminCode: "TST123456", password: "long-password" }))).status).toBe(200);
  expect(m.compare).toHaveBeenCalledWith("long-password", "admin-password-hash"); expect(m.sign).toHaveBeenCalled();
});
