// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: db.read }) }) }) } }));
import { checkMembership } from "./membership";
import { requireAuth } from "./index";
import { signToken } from "./jwt";
import type { AuthUser } from "./types";

const user: AuthUser = { driverId: "driver-a", role: "ADMIN", companyCode: "AAA", orgId: "org-a", identityId: "person-a" };
const row = { role: "ADMIN", status: "active", company_code: "AAA", org_id: "org-a", identity_id: "person-a", token_version: 0 };
const request = { pathname: "/api/admin/payments", method: "GET" };
beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "membership-tests");
  db.read.mockReset().mockResolvedValue({ data: { ...row }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("現在の所属とログイン世代", () => {
  it("既存の世代0の利用者はログアウトさせず継続する", async () => {
    expect(await checkMembership(user, request)).toEqual({ user: { ...user, tokenVersion: 0 } });
  });
  it.each(["inactive", "rejected", null])("status=%s を拒否する", async (status) => {
    db.read.mockResolvedValue({ data: { ...row, status }, error: null });
    expect(await checkMembership(user, request)).toMatchObject({ status: 401 });
  });
  it("削除済みの利用者を拒否する", async () => {
    db.read.mockResolvedValue({ data: null, error: null });
    expect(await checkMembership(user, request)).toMatchObject({ status: 401 });
  });
  it("停止解除後も旧世代を拒否し、新世代だけ通す", async () => {
    db.read.mockResolvedValue({ data: { ...row, token_version: 2 }, error: null });
    expect(await checkMembership(user, request)).toMatchObject({ status: 401 });
    expect(await checkMembership({ ...user, tokenVersion: 2 }, request)).toMatchObject({ user: { tokenVersion: 2 } });
  });
  it.each([{ org_id: "other-org" }, { identity_id: "other-person" }])("会社・本人の不一致を拒否する: %j", async (change) => {
    db.read.mockResolvedValue({ data: { ...row, ...change }, error: null });
    expect(await checkMembership(user, request)).toMatchObject({ status: 401 });
  });
  it("旧トークンの会社・本人未設定は現在のDBから補う", async () => {
    expect(await checkMembership({ ...user, orgId: null, identityId: null }, request)).toMatchObject({ user: { orgId: "org-a", identityId: "person-a" } });
  });
  it("返すロールは現在のDBを使う", async () => {
    db.read.mockResolvedValue({ data: { ...row, role: "ADMIN_VIEWER" }, error: null });
    expect(await checkMembership(user, request)).toMatchObject({ user: { role: "ADMIN_VIEWER" } });
  });
  it("DBエラーを認証失効と混同せず503にする", async () => {
    db.read.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect(await checkMembership(user, request)).toMatchObject({ status: 503 });
  });
});

describe("承認待ちの利用範囲", () => {
  beforeEach(() => db.read.mockResolvedValue({ data: { ...row, status: "pending", role: "DRIVER" }, error: null }));
  it.each([
    ["/api/me/registration", "GET"], ["/api/me/registration", "POST"],
    ["/api/me/registration/photo", "POST"], ["/api/reports/profile", "GET"],
    ["/api/auth/webauthn/register/options", "POST"], ["/api/auth/webauthn/register/verify", "POST"],
  ])("本人登録を継続できる: %s %s", async (pathname, method) => {
    expect(await checkMembership(user, { pathname, method })).toHaveProperty("user");
  });
  it.each([
    ["/api/admin/payments", "GET"], ["/api/reports/v2", "POST"], ["/api/work/check-in", "POST"],
    ["/api/me/shifts", "GET"], ["/api/me/registration/other", "GET"], ["/api/me/registration", "DELETE"],
  ])("業務APIと未指定操作を拒否する: %s %s", async (pathname, method) => {
    expect(await checkMembership(user, { pathname, method })).toMatchObject({ status: 403 });
  });
  it("statusがactiveでもPENDINGロールは業務を拒否する", async () => {
    db.read.mockResolvedValue({ data: { ...row, role: "PENDING" }, error: null });
    expect(await checkMembership(user, request)).toMatchObject({ status: 403 });
  });
});

describe("共通requireAuthからの照合", () => {
  it("有効な署名でも停止済みなら401にする", async () => {
    db.read.mockResolvedValue({ data: { ...row, status: "inactive" }, error: null });
    const token = await signToken({ ...user });
    const response = await requireAuth(new NextRequest("http://localhost/api/admin/payments", { headers: { authorization: `Bearer ${token}` } }));
    expect(response).toHaveProperty("status", 401);
  });
  it("接続自体が例外になっても503を返す", async () => {
    db.read.mockRejectedValue(new Error("network failed"));
    const token = await signToken({ ...user });
    const response = await requireAuth(new NextRequest("http://localhost/api/admin/payments", { headers: { authorization: `Bearer ${token}` } }));
    expect(response).toHaveProperty("status", 503);
  });
});
