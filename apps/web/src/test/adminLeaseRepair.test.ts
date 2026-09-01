import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: vi.fn(), image: vi.fn(), log: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/server/auth", () => ({ requirePermission: mock.auth, requireAnyPermission: mock.auth, isAuthError: (v: unknown) => v instanceof NextResponse }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-a" }));
vi.mock("@/server/shiftLog", () => ({ logShiftChange: mock.log }));
vi.mock("@/server/vehicles/imageStorage", () => ({ storeVehicleImage: mock.image, VEHICLE_IMAGE_BUCKET: "test" }));
vi.mock("@/server/storage/dataUrl", () => ({ resolveStoredUrls: async (_db: unknown, _bucket: unknown, urls: unknown[]) => urls }));
vi.mock("@/server/auth/permissions", () => ({ hasCapabilityCached: async () => true }));
import { GET as leaseGet, PUT as leasePut } from "@/app/api/admin/driver-lease/route";
import { GET as shiftsGet, POST as shiftPost } from "@/app/api/admin/shifts/route";
import { PATCH as shiftDriverOrderPatch } from "@/app/api/admin/shifts/driver-order/route";
import { POST as vehiclePost } from "@/app/api/admin/shifts/vehicle/route";
import { POST as loanPost } from "@/app/api/admin/shifts/vehicle-loans/route";
import { GET as vehiclesGet, POST as vehicleCreate } from "@/app/api/admin/vehicles/route";
import { PUT as vehiclePut } from "@/app/api/admin/vehicles/[id]/route";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const driver = id(1), otherDriver = id(2), course = id(3), otherCourse = id(4), vehicle = id(5), otherVehicle = id(6);
// In-memory query fixture: records which mutations were actually reached; never connects to a DB.
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let writes: string[];
let failedTable: string | null;
class Query {
  filters: ((row: Row) => boolean)[] = [];
  operation = "read";
  payload: Row = {};
  one = false;
  constructor(readonly table: string) {}
  select() { return this; }
  eq(k: string, v: unknown) { this.filters.push(r => r[k] === v); return this; }
  in(k: string, v: unknown[]) { this.filters.push(r => v.includes(r[k])); return this; }
  is(k: string, v: unknown) { return this.eq(k,v); }
  gte(k: string, v: string) { this.filters.push(r => r[k] >= v); return this; }
  lte(k: string, v: string) { this.filters.push(r => r[k] <= v); return this; }
  lt(k: string, v: string) { this.filters.push(r => r[k] < v); return this; }
  or(condition: string) {
    const match = /^valid_to\.is\.null,valid_to\.gte\.(\d{4}-\d{2}-\d{2})$/.exec(condition);
    if (!match) throw new Error(`Unsupported fixture condition: ${condition}`);
    this.filters.push(r => r.valid_to === null || r.valid_to >= match[1]); return this;
  }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { return this.maybeSingle(); }
  update(v: Row) { this.operation = "update"; this.payload = v; return this; }
  upsert(v: Row) { this.operation = "upsert"; this.payload = v; return this; }
  delete() { this.operation = "delete"; return this; }
  then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
    if (failedTable === this.table) return Promise.resolve({ data: null, error: { code: "08006" } }).then(resolve,reject);
    let rows = (tables[this.table] ?? []).filter(r => this.filters.every(f => f(r)));
    if (this.operation !== "read") {
      writes.push(this.table);
      if (this.operation === "update") rows = rows.map(r => Object.assign(r, this.payload));
      if (this.operation === "upsert") rows = [this.payload];
    }
    return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null }).then(resolve,reject);
  }
}
function request(body?: Row, search = "") { return new NextRequest(`http://localhost/api${search}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined); }
beforeEach(() => {
  vi.clearAllMocks(); writes = []; failedTable = null;
  mock.auth.mockResolvedValue({ orgId: "org-a", driverId: driver });
  mock.rpc.mockResolvedValue({ data: { lease: null, revision: "a".repeat(32), upcoming: [] }, error: null });
  mock.image.mockResolvedValue({ ok: true, path: "mock" });
  mock.log.mockResolvedValue(undefined);
  tables = {
    drivers: [{ id: driver, org_id: "org-a", name: "自社", status: "active", works_as_driver: true, driver_identities: [] }, { id: otherDriver, org_id: "org-b", name: "他社", status: "active", works_as_driver: true, driver_identities: [] }],
    courses: [{ id: course, org_id: "org-a" }, { id: otherCourse, org_id: "org-b" }],
    vehicles: [{ id: vehicle, owner_org_id: "org-a", is_disposed: false }, { id: otherVehicle, owner_org_id: "org-b", is_disposed: false }],
    shifts: [{ id: id(7), course_id: course, driver_id: driver, vehicle_id: vehicle, shift_date: "2026-09-01", cycle_no: 0, slot: 1 }, { id: id(8), course_id: otherCourse, driver_id: otherDriver, vehicle_id: otherVehicle, shift_date: "2026-09-01" }],
    vehicle_drivers: [{ driver_id: driver, vehicle_id: vehicle }, { driver_id: otherDriver, vehicle_id: otherVehicle }],
    vehicle_loans: [], shift_requests: [{ driver_id: driver, request_date: "2026-09-02" }, { driver_id: otherDriver, request_date: "2026-09-02" }], shift_request_slots: [],
  };
  mock.from.mockImplementation((table: string) => new Query(table));
});

describe("契約API", () => {
  const valid = () => ({ driver_id: driver, enabled: true, mode: "MONTHLY", amount: 35000, valid_from: "2026-09-01", expected_revision: "a".repeat(32) });
  it("操作権限がなければDBへ進まない", async () => {
    mock.auth.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await leasePut(request(valid()))).status).toBe(403); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("会社は入力を使わず認証情報からRPCへ渡す", async () => {
    expect((await leasePut(request({ ...valid(), org_id: "org-b" }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("save_driver_lease", expect.objectContaining({ p_org_id: "org-a", p_driver_id: driver, p_expected_revision: "a".repeat(32) }));
  });
  it.each([{ valid_from: "2026-02-30" }, { valid_from: "2026-09-15" }, { amount: -1 }, { amount: 1.5 }, { mode: "UNKNOWN" }])("不正入力は更新前に拒否: %o", async patch => {
    expect((await leasePut(request({ ...valid(), ...patch }))).status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("読込時のrevisionがなければ更新しない", async () => {
    expect((await leasePut(request({ ...valid(), expected_revision: null }))).status).toBe(428); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([["P0002",404],["40001",409],["PGRST202",503],["08006",500]])("RPCエラー %s を成功に変えず返す", async (code,status) => {
    mock.rpc.mockResolvedValue({ data:null,error:{code} });
    expect((await leasePut(request(valid()))).status).toBe(status); expect(mock.from).not.toHaveBeenCalled();
  });
  it("現在と指定日の読込にも会社を渡す", async () => {
    await leaseGet(request(undefined,`?driver_id=${driver}&date=2026-09-01`));
    expect(mock.rpc).toHaveBeenCalledWith("driver_lease_state", { p_org_id:"org-a",p_driver_id:driver,p_date:"2026-09-01" });
  });
});

describe("シフトと配車の会社境界", () => {
  it("シフトの閲覧権限がなければ契約区分も読まない", async () => {
    mock.auth.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await shiftsGet(request(undefined, "?start=2026-09-01&end=2026-09-15"))).status).toBe(403);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("自社かつ表示期間に重なる契約区分だけを返し、金額は含めない", async () => {
    const current = { id: id(20), driver_id: driver, mode: "DAILY", valid_from: "2026-09-01", valid_to: null, amount: 0, updated_at: "private" };
    tables.driver_leases = [current, { ...current, id: id(21), driver_id: otherDriver },
      { ...current, id: id(22), valid_from: "2026-08-01", valid_to: "2026-08-31" },
      { ...current, id: id(23), valid_from: "2026-09-16" }];
    const data = await (await shiftsGet(request(undefined, "?start=2026-09-01&end=2026-09-15"))).json();
    expect(data.driver_leases).toEqual([{ id: id(20), driver_id: driver, mode: "DAILY", valid_from: "2026-09-01", valid_to: null }]);
    expect(writes).toEqual([]);
    expect(mock.auth).toHaveBeenCalledWith(expect.anything(), "can_view_shifts");
  });
  it("契約区分だけの取得失敗はnullで明示しシフトを維持する", async () => {
    failedTable = "driver_leases";
    const response = await shiftsGet(request(undefined, "?start=2026-09-01&end=2026-09-15"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.driver_leases).toBeNull(); expect(data.shifts).toHaveLength(1);
  });
  it("関連する予定・希望休・車両紐付けを自社だけ返す", async () => {
    const data = await (await shiftsGet(request(undefined,"?start=2026-09-01&end=2026-09-15"))).json();
    expect(data.shifts).toHaveLength(1); expect(data.shifts[0].drivers.name).toBe("自社");
    expect(data.requests).toHaveLength(1); expect(data.vehicle_driver_links).toEqual([{driver_id:driver,vehicle_id:vehicle}]);
    expect(JSON.stringify(data)).not.toContain(otherDriver); expect(JSON.stringify(data)).not.toContain(otherVehicle);
  });
  it("稼働人数の軽量取得にも自社条件を適用する",async () => {
    const response=await shiftsGet(request(undefined,"?start=2026-09-01&end=2026-09-15&countDrivers=1"));
    expect(await response.json()).toEqual({count:1}); expect(mock.from).not.toHaveBeenCalledWith("vehicles");
    expect(mock.from).not.toHaveBeenCalledWith("driver_leases");
  });
  it("自社の集合が空なら他社データを返さない", async () => {
    mock.auth.mockResolvedValue({orgId:"empty",driverId:driver});
    const data=await (await shiftsGet(request(undefined,"?start=2026-09-01&end=2026-09-15"))).json();
    expect(data.shifts).toEqual([]); expect(data.requests).toEqual([]); expect(data.vehicle_driver_links).toEqual([]);
    expect(data.driver_leases).toEqual([]); expect(mock.from).not.toHaveBeenCalledWith("driver_leases");
  });
  it("既存の不正な会社横断参照を返さない", async () => {
    tables.shifts.push({...tables.shifts[0],driver_id:otherDriver});
    tables.shifts[0].vehicle_id=otherVehicle;
    const data=await (await shiftsGet(request(undefined,"?start=2026-09-01&end=2026-09-15"))).json();
    expect(data.shifts).toHaveLength(1); expect(data.shifts[0].vehicle_id).toBeNull(); expect(JSON.stringify(data)).not.toContain(otherDriver);
  });
  it("取得エラーを空の正常データにしない", async () => {
    failedTable="shift_requests";
    expect((await shiftsGet(request(undefined,"?start=2026-09-01&end=2026-09-15"))).status).toBe(500);
  });
  it.each([{courseId:otherCourse,driverId:driver},{courseId:course,driverId:otherDriver},{courseId:otherCourse,driverId:null}])("シフトの割当・解除の越境を拒否 %o",async patch => {
    expect((await shiftPost(request({shiftDate:"2026-09-01",...patch}))).status).toBe(404); expect(writes).toEqual([]);
  });
  it("車両の解除でも他社コースを変更できない",async () => {
    expect((await vehiclePost(request({shiftDate:"2026-09-01",courseId:otherCourse,vehicleId:null}))).status).toBe(404); expect(writes).toEqual([]);
  });
  it("自社でも既存の時間帯別車両共有を禁止しない",async () => {
    tables.drivers.push({...tables.drivers[0],id:id(9)});
    tables.shifts.push({...tables.shifts[0],driver_id:id(9),slot:2});
    expect((await vehiclePost(request({shiftDate:"2026-09-01",courseId:course,vehicleId:vehicle}))).status).toBe(200); expect(writes).toEqual(["shifts"]);
  });
  it("貸出照合に失敗したら配車しない",async () => {
    failedTable="vehicle_loans";
    expect((await vehiclePost(request({shiftDate:"2026-09-01",courseId:course,vehicleId:vehicle}))).status).toBe(500); expect(writes).toEqual([]);
  });
  it.each([true,false])("他社車両の社外貸出を設定・解除できない: %s",async loaned => {
    expect((await loanPost(request({vehicleId:otherVehicle,date:"2026-09-01",loaned}))).status).toBe(404); expect(writes).toEqual([]);
  });
});

describe("シフト表の行順", () => {
  const orderRequest = (order: string[]) => new NextRequest("http://localhost/api/admin/shifts/driver-order", {
    method: "PATCH",
    body: JSON.stringify({ order }),
  });

  it("認証した会社と検証済みの順番だけをRPCへ渡す", async () => {
    const response = await shiftDriverOrderPatch(orderRequest([driver]));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("reorder_shift_drivers", {
      p_org_id: "org-a",
      p_driver_ids: [driver],
    });
  });

  it("重複やUUIDでない値はDB更新前に拒否する", async () => {
    expect((await shiftDriverOrderPatch(orderRequest([driver, driver]))).status).toBe(400);
    expect((await shiftDriverOrderPatch(orderRequest(["driver-a"]))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("他社または非稼働のドライバーを含む順番は保存しない", async () => {
    expect((await shiftDriverOrderPatch(orderRequest([otherDriver]))).status).toBe(404);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

describe("車両の一括保存", () => {
  const params = {params:Promise.resolve({id:vehicle})};
  it("稼働終了者も紐付けの比較基準に含め、表示は稼働中だけを保つ",async () => {
    tables.vehicles[0].vehicle_drivers=[
      {driver_id:driver,drivers:{org_id:"org-a",works_as_driver:true,status:"active"}},
      {driver_id:id(10),drivers:{org_id:"org-a",works_as_driver:true,status:"inactive"}},
      {driver_id:otherDriver,drivers:{org_id:"org-b",works_as_driver:true,status:"active"}},
    ];
    const response=await (await vehiclesGet(request())).json();
    expect(response.vehicles[0].driver_link_ids).toEqual([driver,id(10)]);
    expect(response.vehicles[0].vehicle_drivers).toHaveLength(1); expect(JSON.stringify(response)).not.toContain(otherDriver);
  });
  it("新規車両も紐付けと同じRPCで保存する",async () => {
    expect((await vehicleCreate(request({manufacturer:"試験",driverIds:[driver]}))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("save_vehicle_with_drivers",expect.objectContaining({p_create:true,p_driver_ids:[driver],p_expected_driver_ids:[]})); expect(writes).toEqual([]);
  });
  it("新規作成でも他社ドライバーを画像保存前に拒否する",async () => {
    expect((await vehicleCreate(request({manufacturer:"試験",driverIds:[otherDriver]}))).status).toBe(404);
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.image).not.toHaveBeenCalled();
  });
  it("他社車両を画像保存前に拒否する",async () => {
    expect((await vehiclePut(request({imageUrl:"mock"}),{params:Promise.resolve({id:otherVehicle})})).status).toBe(404);
    expect(mock.image).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("他社ドライバーの紐付けを本体変更前に拒否する",async () => {
    expect((await vehiclePut(request({driverIds:[otherDriver],expectedDriverIds:[driver]}),params)).status).toBe(404); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("本体と紐付けは1つのRPCで保存する",async () => {
    expect((await vehiclePut(request({manufacturer:"new",driverIds:[driver],expectedDriverIds:[driver]}),params)).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("save_vehicle_with_drivers",expect.objectContaining({p_org_id:"org-a",p_vehicle_id:vehicle,p_driver_ids:[driver],p_expected_driver_ids:[driver]})); expect(writes).toEqual([]);
  });
  it("紐付けを触らないモバイルの部分更新は互換性を保つ",async () => {
    expect((await vehiclePut(request({manufacturer:"new"}),params)).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("save_vehicle_with_drivers",expect.objectContaining({p_driver_ids:null}));
  });
  it("未適用時に危険な逐次更新へ戻らない",async () => {
    mock.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});
    expect((await vehiclePut(request({driverIds:[],expectedDriverIds:[driver]}),params)).status).toBe(503); expect(writes).toEqual([]);
  });
});
