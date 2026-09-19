// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, any>[]>, mutations: [] as string[], snapshots: vi.fn(), denied: false }));
vi.mock("@/server/auth", () => ({
  requirePermission: vi.fn(async () => h.denied ? new Response(null, { status: 403 }) : ({ driverId: "a-admin", orgId: "a" })),
  isAuthError: (v: unknown) => v instanceof Response,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "a" }));
vi.mock("@/server/afterSafely", () => ({ afterSafely: vi.fn() }));
vi.mock("@/server/aggregation/rateSnapshot", () => ({ captureReportRateSnapshots: h.snapshots }));
vi.mock("@/server/db/client", () => ({ supabase: { rpc: async (name: string, args: any) => {
  if (name !== "save_vehicle_with_drivers") throw new Error("Unexpected RPC");
  const row = h.tables.vehicles.find(v => v.id === args.p_vehicle_id && v.owner_org_id === args.p_org_id);
  if (!row) return { data: null, error: { code: "P0002" } };
  h.mutations.push("vehicles"); Object.assign(row, args.p_patch); return { data: row, error: null };
}, from: (table: string) => {
  let mode = "select", payload: any, single = false;
  const filters: ((r: any) => boolean)[] = [];
  const q: any = {
    select: () => q, order: () => q, limit: () => q,
    eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
    gte: (k: string, v: any) => { filters.push(r => r[k] >= v); return q; },
    lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return q; },
    is: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return q; },
    in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
    update: (p: any) => { mode = "update"; payload = p; return q; },
    insert: (p: any) => { mode = "insert"; payload = p; return q; },
    delete: () => { mode = "delete"; return q; },
    maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
    then: (resolve: any) => {
      const all = h.tables[table] ??= [];
      let rows = all.filter(r => filters.every(f => f(r)));
      if (mode !== "select") h.mutations.push(table);
      if (mode === "update") rows.forEach(r => Object.assign(r, payload));
      if (mode === "delete") h.tables[table] = all.filter(r => !rows.includes(r));
      if (mode === "insert") { const row = { id: `new-${all.length}`, ...payload }; all.push(row); rows = [row]; }
      return Promise.resolve({ data: single ? rows[0] ?? null : rows.map(r => ({ ...r })), error: null }).then(resolve);
    },
  }; return q;
} } }));
import { POST as approve } from "@/app/api/admin/misc-reports/oil-change/approve/route";
import { POST as reject } from "@/app/api/admin/misc-reports/oil-change/reject/route";
import { POST as dailyApprove } from "@/app/api/admin/daily/approve/route";
import { POST as dailyReject } from "@/app/api/admin/daily/reject/route";
import { POST as attendance } from "@/app/api/admin/attendance/[id]/route";
import { GET as attendanceList } from "@/app/api/admin/attendance/route";
import { GET as checkVehicleNumber } from "@/app/api/admin/vehicles/check-number/route";
import { PUT as updateVehicle } from "@/app/api/admin/vehicles/[id]/route";
import { GET as vehicleDetail } from "@/app/api/admin/vehicles/[id]/detail/route";
import { PATCH as editKind, DELETE as deleteKind } from "@/app/api/admin/report-kinds/[id]/route";
const req = (body: unknown) => new NextRequest("http://localhost/api/test", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
 h.mutations = []; h.snapshots.mockReset(); h.denied = false;
 h.tables = {
   drivers: [ { id: "a-driver", org_id: "a" }, { id: "b-driver", org_id: "b", name: "他社の運転者" } ],
   vehicles: [{ id: "a-vehicle", owner_org_id: "a", current_mileage: 100 }, { id: "b-vehicle", owner_org_id: "b", current_mileage: 200 }],
   oil_change_reports: ["a", "b"].map(org => ({ id: `${org}-report`, org_id: org, driver_id: `${org}-driver`, vehicle_id: `${org}-vehicle`, report_kind: "expense", report_date: "2026-09-12", expense_amount: 1000, description: "駐車料金" })),
   driver_ad_hoc_expenses: [{ id: "b-expense", driver_id: "b-driver", misc_report_id: "b-report", amount: -1000 }],
   report_kinds: ["a", "b"].map(org => ({ id: `${org}-kind`, org_id: org, key: "expense", capability: "expense", uses_amount: true })),
   daily_reports_v2: ["a", "b"].map(org => ({ id: `${org}-daily`, org_id: org, driver_id: `${org}-driver`, report_date: "2026-09-12", vehicle_id: `${org}-vehicle`, meter_value: 150 })),
   shifts: [{ id: "shift", driver_id: "a-driver", shift_date: "2026-09-12" }],
   vehicle_sessions: [{ id: "b-session", org_id: "b", vehicle_id: "a-vehicle", recorded_by: "b-driver", status: "open", approval_status: "pending" }],
   vehicle_positions: [{ org_id: "a", vehicle_id: "a-vehicle", recorded_by: "b-driver", at: "2026-09-12", lat: 35, lng: 139 }],
 };
});
describe("部位別色の保存範囲", () => {
  const own = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
  it("自社の部位色を保存・解除し、他社と権限なしの更新を拒否する", async () => {
    h.tables.vehicles = [{ id: own, owner_org_id: "a" }, { id: other, owner_org_id: "b" }];
    expect((await updateVehicle(req({ partColors: { hood: "#111111" } }), ctx(own))).status).toBe(200);
    expect(h.tables.vehicles[0].part_colors).toEqual({ hood: "#111111" });
    expect((await updateVehicle(req({ partColors: {} }), ctx(own))).status).toBe(200);
    expect(h.tables.vehicles[0].part_colors).toEqual({});
    h.mutations = [];
    expect((await updateVehicle(req({ partColors: {} }), ctx(other))).status).toBe(404);
    h.denied = true;
    expect((await updateVehicle(req({ partColors: {} }), ctx(own))).status).toBe(403);
    expect(h.mutations).toEqual([]);
  });
  it("不正な部位や色はDB更新前に拒否する", async () => {
    h.tables.vehicles = [{ id: own, owner_org_id: "a" }];
    for (const partColors of [{ hood: "red" }, { roof: "#111111" }, null, []]) expect((await updateVehicle(req({ partColors }), ctx(own))).status).toBe(400);
    expect(h.mutations).toEqual([]);
  });
});
describe("会社をまたぐID指定", () => {
  it.each([approve, reject])("他社・存在しない諸報告を404にし、経費・車両を変更しない", async run => {
    for (const id of ["b-report", "missing"]) {
      const before = structuredClone(h.tables);
      expect((await run(req({ id }))).status).toBe(404);
      expect(h.tables).toEqual(before); expect(h.mutations).toEqual([]);
    }
  });
  it.each([approve, reject])("自社報告のdriver_idが他社でも更新しない", async run => {
    h.tables.oil_change_reports[0].driver_id = "b-driver";
    expect((await run(req({ id: "a-report" }))).status).toBe(404);
    expect(h.mutations).toEqual([]);
  });
  it("自社報告の車両が他社でも更新しない", async () => {
    h.tables.oil_change_reports[0].vehicle_id = "b-vehicle";
    expect((await approve(req({ id: "a-report" }))).status).toBe(404); expect(h.mutations).toEqual([]);
  });
  it("自社経費の再承認は1行を更新し、却下は自社分だけ消す", async () => {
    expect((await approve(req({ id: "a-report" }))).status).toBe(200);
    expect((await approve(req({ id: "a-report" }))).status).toBe(200);
    expect(h.tables.driver_ad_hoc_expenses).toHaveLength(2);
    expect(h.tables.driver_ad_hoc_expenses[1].amount).toBe(-1000);
    expect((await reject(req({ id: "a-report" }))).status).toBe(200);
    expect(h.tables.driver_ad_hoc_expenses.map(r => r.id)).toEqual(["b-expense"]);
  });
  it.each([dailyApprove, dailyReject])("他社ドライバーの日報に副作用を起こさない", async run => {
    expect((await run(req({ driverId: "b-driver", date: "2026-09-12" }))).status).toBe(404);
    expect(h.mutations).toEqual([]); expect(h.snapshots).not.toHaveBeenCalled();
  });
  it.each([150, null])("日報の他社車両はメーター有無を問わず承認・単価固定の前に拒否", async meter => {
    h.tables.daily_reports_v2[0].vehicle_id = "b-vehicle";
    h.tables.daily_reports_v2[0].meter_value = meter;
    expect((await dailyApprove(req({ driverId: "a-driver", date: "2026-09-12" }))).status).toBe(404);
    expect(h.mutations).toEqual([]); expect(h.snapshots).not.toHaveBeenCalled();
  });
  it("正式な当日貸与なら他社所有車の走行距離も更新できる", async () => {
    h.tables.daily_reports_v2[0].vehicle_id = "b-vehicle";
    h.tables.daily_reports_v2[0].meter_value = 250;
    h.tables.vehicle_loans = [{ vehicle_id: "b-vehicle", borrower_org_id: "a", loan_date: "2026-09-12" }];
    expect((await dailyApprove(req({ driverId: "a-driver", date: "2026-09-12" }))).status).toBe(200);
    expect(h.tables.vehicles[1].current_mileage).toBe(250);
  });
  it("別日の貸与では他社車両の報告を承認できない", async () => {
    h.tables.daily_reports_v2[0].vehicle_id = "b-vehicle";
    h.tables.vehicle_loans = [{ vehicle_id: "b-vehicle", borrower_org_id: "a", loan_date: "2026-09-11" }];
    expect((await dailyApprove(req({ driverId: "a-driver", date: "2026-09-12" }))).status).toBe(404);
    expect(h.mutations).toEqual([]); expect(h.snapshots).not.toHaveBeenCalled();
  });
  it.each([true, false])("勤怠一覧は当日貸与された他社車両だけナンバーを表示する", async loaned => {
    h.tables.vehicles[1].number_numeric = "9999";
    h.tables.vehicle_sessions = [{ id: "a-session", org_id: "a", recorded_by: "a-driver", vehicle_id: "b-vehicle", started_at: "2026-09-12T09:00:00+09:00" }];
    h.tables.vehicle_loans = loaned ? [{ vehicle_id: "b-vehicle", borrower_org_id: "a", loan_date: "2026-09-12" }] : [];
    const response = await attendanceList(new NextRequest("http://localhost/api/admin/attendance?date=2026-09-12"));
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].plate).toBe(loaned ? "9999" : "");
  });
  it("自社の日報は走行距離を更新して承認できる", async () => {
    expect((await dailyApprove(req({ driverId: "a-driver", date: "2026-09-12" }))).status).toBe(200);
    expect(h.tables.vehicles[0].current_mileage).toBe(150); expect(h.tables.vehicles[1].current_mileage).toBe(200);
  });
  it("他社の打刻・報告種別は404", async () => {
    expect((await attendance(req({ action: "approve" }), ctx("b-session"))).status).toBe(404);
    expect((await editKind(req({ label: "改ざん" }), ctx("b-kind"))).status).toBe(404);
    expect((await deleteKind(req({}), ctx("b-kind"))).status).toBe(404);
    expect(h.tables.report_kinds[1].label).toBeUndefined();
  });
  it("移管後の車両に他社の打刻・氏名を含めない", async () => {
    const response = await vehicleDetail(req({}), ctx("a-vehicle"));
    const { vehicle } = await response.json();
    expect(vehicle.position.driverName).toBe(""); expect(vehicle.position.placedBy).toBe("");
    expect((await vehicleDetail(req({}), ctx("b-vehicle"))).status).toBe(404);
  });
  it("権限なしはDBに到達しない", async () => {
    h.denied = true;
    expect((await approve(req({ id: "a-report" }))).status).toBe(403); expect(h.mutations).toEqual([]);
  });
});


describe("車検証のナンバー確認", () => {
  it("同じ番号の他社車両は返さず、権限なしは403にする", async () => {
    const number = { number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1234", is_disposed: false };
    h.tables.vehicles = ["a", "b"].map(org => ({ ...number, id: `${org}-vehicle`, owner_org_id: org }));
    const query = new URLSearchParams({ numberPrefix: "大阪", numberClass: "480", numberHiragana: "り", numberNumeric: "1234" });
    const request = new NextRequest(`http://localhost/api/admin/vehicles/check-number?${query}`);
    const response = await checkVehicleNumber(request);
    expect(response.status).toBe(200);
    expect((await response.json()).vehicles.map((v: { id: string }) => v.id)).toEqual(["a-vehicle"]);
    h.denied = true;
    expect((await checkVehicleNumber(request)).status).toBe(403);
    expect(h.mutations).toEqual([]);
  });
});
