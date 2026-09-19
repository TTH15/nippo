// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// シフト1セルの割当（O-3）。RPC の結果をどう画面へ返すか、
// そして **どんなときだけ従来経路へ落とすか** を固定する。
// 設計: docs/design/operational-risk-detection-2026-09.md O-3
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), log: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: m.rpc, from: m.from } }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "actor", orgId: "org-1", capabilities: new Set() }),
  isAuthError: () => false,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-1" }));
vi.mock("@/server/db/adminResourceScope", () => ({
  adminMutationError: () => new Response(JSON.stringify({ error: "db" }), { status: 500 }),
  belongsToOrg: async () => true,
  isDateOnly: (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  isUuid: (v: unknown) => typeof v === "string" && v.length > 0,
}));
vi.mock("@/server/shiftLog", () => ({ logShiftChange: m.log }));

import { POST } from "./route";

const COURSE = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const body = { shiftDate: "2026-09-25", courseId: COURSE, cycleNo: 1, slot: 1, driverId: DRIVER };

const post = (extra: object = {}) =>
  POST(new NextRequest("http://localhost/api/admin/shifts", { method: "POST", body: JSON.stringify({ ...body, ...extra }) }));

/** 従来経路（RPC が無いときだけ通る）で使われるクエリビルダ */
function legacyBuilder() {
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "upsert", "eq"]) chain[key] = () => chain;
  chain.maybeSingle = async () => ({ data: { driver_id: null }, error: null });
  chain.single = async () => ({ data: { id: "row-1", driver_id: DRIVER }, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.from.mockImplementation(() => legacyBuilder());
});

describe("割当の保存", () => {
  it("RPC が通れば結果をそのまま返し、従来経路は使わない", async () => {
    m.rpc.mockResolvedValue({ data: { id: "row-1" }, error: null });
    const res = await post({ expectedDriverId: null, hasExpectation: true });
    expect(res.status).toBe(200);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("読み込み後に他の人が変えていたら 409", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Shift changed since it was loaded" } });
    const res = await post({ expectedDriverId: null, hasExpectation: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true });
    expect(m.from).not.toHaveBeenCalled();
  });

  it("コース・便・ドライバーが使えなければ 404", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Course or cycle is unavailable" } });
    expect((await post()).status).toBe(404);
  });

  it("所属・実行者が不正なら 403（関数の権限不足とは分ける）", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Invalid organization or actor" } });
    expect((await post()).status).toBe(403);
  });

  it("関数が無い環境（migration 未適用）だけ従来経路へ落とす", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.from).toHaveBeenCalled();
  });

  it("実行権限が無い環境も従来経路へ落とす（画面を止めない）", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function" } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.from).toHaveBeenCalled();
  });

  it("★それ以外のエラーでは従来経路へ落とさない（競合検知が黙って無効にならない）", async () => {
    // 引数を増やして古い定義が残ると PGRST203 が返る。メッセージには関数名が含まれるので、
    // 文面で判定していると無条件 upsert へ落ちて後勝ちが復活してしまう
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST203", message: "Could not choose the best candidate function between: public.assign_shift_driver(...)" },
    });
    const res = await post();
    expect(res.status).toBe(500);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("従来経路でも変更ログに便番号を渡す", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await post();
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ cycleNo: 1, action: "assign_driver" }));
  });

  it("期待値が UUID でなければ 400", async () => {
    expect((await post({ expectedDriverId: "", hasExpectation: true })).status).toBe(400);
  });
});
