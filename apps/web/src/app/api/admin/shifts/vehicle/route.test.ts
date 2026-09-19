// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 配車の後勝ちを止める条件（O-3）を、DB を使わずに検証する。
// 設計: docs/design/operational-risk-detection-2026-09.md O-3
const m = vi.hoisted(() => ({ from: vi.fn(), log: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "actor", orgId: "org-1", capabilities: new Set() }),
  isAuthError: () => false,
}));
vi.mock("@/server/db/adminResourceScope", () => ({
  adminMutationError: () => new Response(JSON.stringify({ error: "db" }), { status: 500 }),
  belongsToOrg: async () => true,
  isDateOnly: (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  isUuid: (v: unknown) => typeof v === "string" && v.length > 0,
}));
vi.mock("@/server/shiftLog", () => ({ logShiftChange: m.log }));

import { POST } from "./route";

const DATE = "2026-09-25";
const COURSE = "11111111-1111-4111-8111-111111111111";
const OLD_VEHICLE = "22222222-2222-4222-8222-222222222222";
const NEW_VEHICLE = "33333333-3333-4333-8333-333333333333";

/** 呼ばれた絞り込みを記録しつつ、終端で決められた結果を返す薄いクエリビルダ */
function builder(result: { data: unknown; error: unknown }, filters: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "update", "eq", "is", "not", "gte", "lte", "order", "limit"]) {
    chain[key] = (...args: unknown[]) => {
      if (key === "eq" || key === "is") filters[String(args[0])] = args[1] ?? null;
      return chain;
    };
  }
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  return chain;
}

type Setup = {
  /** 変更前の行（null = その枠が無い） */
  previous: { driver_id: string | null; vehicle_id: string | null; uses_external_vehicle: boolean } | null;
  /** UPDATE の戻り（null = 条件に合わず0行） */
  updated: Record<string, unknown> | null;
};

/** shifts テーブルへの select / update を順に返す */
function mockTables(setup: Setup) {
  const updateFilters: Record<string, unknown> = {};
  let shiftsCall = 0;
  m.from.mockImplementation((table: string) => {
    if (table === "vehicles") {
      return builder({ data: { id: NEW_VEHICLE, is_disposed: false, is_unavailable: false }, error: null }, {});
    }
    if (table === "vehicle_loans") return builder({ data: null, error: null }, {});
    if (table === "shifts") {
      shiftsCall += 1;
      // 1回目 = 変更前の読み取り、2回目 = 更新、3回目 = 枠の有無の確認
      if (shiftsCall === 1) return builder({ data: setup.previous, error: null }, {});
      if (shiftsCall === 2) return builder({ data: setup.updated, error: null }, updateFilters);
      return builder({ data: setup.previous, error: null }, {});
    }
    return builder({ data: null, error: null }, {});
  });
  return updateFilters;
}

const post = (body: object) =>
  POST(new NextRequest("http://localhost/api/admin/shifts/vehicle", { method: "POST", body: JSON.stringify(body) }));

const base = { shiftDate: DATE, courseId: COURSE, slot: 1, cycleNo: 1 };

beforeEach(() => vi.clearAllMocks());

describe("配車の競合検知", () => {
  it("画面で見ていた車両と一致すれば保存する", async () => {
    const filters = mockTables({
      previous: { driver_id: "d1", vehicle_id: OLD_VEHICLE, uses_external_vehicle: false },
      updated: { id: "row-1", vehicle_id: NEW_VEHICLE },
    });
    const res = await post({ ...base, vehicleId: NEW_VEHICLE, expectedVehicleId: OLD_VEHICLE, hasExpectation: true });
    expect(res.status).toBe(200);
    // 期待値が UPDATE の条件に入っていること（後勝ちを止める本体）
    expect(filters.vehicle_id).toBe(OLD_VEHICLE);
  });

  it("期待値が null のときは「車両なし」を条件にする", async () => {
    const filters = mockTables({
      previous: { driver_id: "d1", vehicle_id: null, uses_external_vehicle: false },
      updated: { id: "row-1", vehicle_id: NEW_VEHICLE },
    });
    await post({ ...base, vehicleId: NEW_VEHICLE, expectedVehicleId: null, hasExpectation: true });
    expect(filters.vehicle_id).toBeNull();
  });

  it("他の人が先に変えていたら 409 で止める（枠はある）", async () => {
    mockTables({
      previous: { driver_id: "d1", vehicle_id: OLD_VEHICLE, uses_external_vehicle: false },
      updated: null,
    });
    const res = await post({ ...base, vehicleId: NEW_VEHICLE, expectedVehicleId: OLD_VEHICLE, hasExpectation: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true });
  });

  it("枠そのものが無ければ 404（競合と区別する）", async () => {
    mockTables({ previous: null, updated: null });
    const res = await post({ ...base, vehicleId: NEW_VEHICLE, expectedVehicleId: null, hasExpectation: true });
    expect(res.status).toBe(404);
  });

  it("期待値を送らない古い呼び出しは、条件を付けずに従来どおり保存する", async () => {
    const filters = mockTables({
      previous: { driver_id: "d1", vehicle_id: OLD_VEHICLE, uses_external_vehicle: false },
      updated: { id: "row-1", vehicle_id: NEW_VEHICLE },
    });
    const res = await post({ ...base, vehicleId: NEW_VEHICLE });
    expect(res.status).toBe(200);
    expect(filters.vehicle_id).toBeUndefined();
  });

  it("変更ログに便番号を渡す（便を使うコースのログが 0 にならない）", async () => {
    mockTables({
      previous: { driver_id: "d1", vehicle_id: OLD_VEHICLE, uses_external_vehicle: false },
      updated: { id: "row-1", vehicle_id: NEW_VEHICLE },
    });
    await post({ ...base, vehicleId: NEW_VEHICLE, expectedVehicleId: OLD_VEHICLE, hasExpectation: true });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ cycleNo: 1, action: "assign_vehicle" }));
  });
});
