// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ from: vi.fn(), filters: [] as unknown[][], failPage: false }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({ requirePermission: async () => ({ driverId: "actor", orgId: "own" }), isAuthError: () => false }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "own" }));
vi.mock("@/server/shiftLog", () => ({ logShiftChange: vi.fn() }));
import { GET } from "./route";

function query(table: string, rows: Record<string, unknown>[]) {
  let data = rows;
  let pageFrom = 0, pageTo = 999;
  const q: any = { then: (resolve: any) => Promise.resolve({ data: data.slice(pageFrom, pageTo + 1), error: m.failPage && table === "shifts" && pageFrom > 0 ? { code: "XX000" } : null }).then(resolve) };
  for (const op of ["select", "eq", "in", "gte", "lte", "lt", "order", "or", "range"]) q[op] = (...args: any[]) => {
    m.filters.push([table, op, ...args]);
    if (op === "eq") data = data.filter(r => r[args[0]] === args[1]);
    if (op === "in") {
      if (args[1].length > 200) throw new Error("IN clause is too large");
      data = data.filter(r => args[1].includes(r[args[0]]));
    }
    if (op === "range") [pageFrom, pageTo] = args;
    if (op === "gte") data = data.filter(r => String(r[args[0]]) >= args[1]);
    if (op === "lte") data = data.filter(r => String(r[args[0]]) <= args[1]);
    if (op === "lt") data = data.filter(r => String(r[args[0]]) < args[1]);
    return q;
  };
  return q;
}

it("終了者と移行前実績を保持し、新規・期間外・他社を除く（過去コースも保持）", async () => {
  m.filters.length = 0;
  const driver = (id: string, extra: object = {}) => ({ id, name: id, status: "active", works_as_driver: true, org_id: "own", created_at: "2025-01-01T00:00:00Z", driver_identities: [], ...extra });
  const tables: Record<string, Record<string, unknown>[]> = {
    courses: [{ id: "c", org_id: "own", archived_at: "2026-09-01", uses_cycles: true,
      course_cycles: [{ cycle_no: 1, active: false }, { cycle_no: 2, active: true }] }, { id: "foreign-c", org_id: "other" }],
    drivers: [driver("ended", { status: "inactive", active_from_month: "2026-01", active_until_month: "2026-08" }),
      driver("new", { created_at: "2026-09-01T00:00:00Z" }), driver("later", { active_from_month: "2026-09" }),
      driver("early-end", { status: "inactive", active_until_month: "2026-07" }),
      driver("legacy", { created_at: "2026-09-01T00:00:00Z" }), driver("foreign", { org_id: "other" }),
      driver("pending", { status: "pending" }), driver("no-shifts")],
    shifts: [
      { id: "s1", course_id: "c", driver_id: "ended", shift_date: "2026-08-01", cycle_no: 1, slot: 1 },
      { id: "s2", course_id: "c", driver_id: "legacy", shift_date: "2026-08-15" },
      { id: "s3", course_id: "c", driver_id: "foreign", shift_date: "2026-08-01" },
      { id: "s4", course_id: "foreign-c", driver_id: "new", shift_date: "2026-08-01" },
    ],
  };
  m.from.mockImplementation((table: string) => query(table, tables[table] ?? []));
  const response = await GET(new NextRequest("http://localhost/api/admin/shifts?start=2026-08-01&end=2026-08-15"));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.drivers.map((d: any) => d.id)).toEqual(["ended", "legacy", "no-shifts"]);
  expect(result.shifts.map((s: any) => s.id)).toEqual(["s1", "s2"]);
  expect(result.courses.map((c: any) => c.id)).toEqual(["c"]);
  expect(result.courses[0].course_cycles[0]).toEqual({ cycle_no: 1, active: false });
  expect(result.shifts[0]).toMatchObject({ driver_id: "ended", cycle_no: 1 });
  expect(result.drivers[0].driver_identities).toEqual([]); // 実績を編集用の担当コースへ補完しない
  expect(m.filters).toContainEqual(["drivers", "eq", "org_id", "own"]);
  expect(m.filters).toContainEqual(["courses", "eq", "org_id", "own"]);
});

describe("期間の境界", () => {
  it("不正・逆転期間を拒否する", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/shifts?start=2026-08-16&end=2026-08-15"));
    expect(response.status).toBe(400);
  });
});

describe("1000件を超える過去期間の読み取り", () => {
  const setup = () => {
    m.failPage = false;
    m.filters.length = 0;
    const courses = Array.from({ length: 1005 }, (_, i) => ({ id: `c${i}`, org_id: "own", archived_at: i === 1004 ? "2026-09-01" : null }));
    const drivers = Array.from({ length: 1005 }, (_, i) => ({ id: `d${i}`, name: `driver${i}`, org_id: "own", works_as_driver: true,
      status: i === 1004 ? "inactive" : "active", active_from_month: i === 1004 ? "2026-09" : "2026-01", driver_identities: [] }));
    const shifts = Array.from({ length: 2001 }, (_, i) => ({ id: `s${i}`, course_id: "c0", driver_id: `d${i % 1005}`, shift_date: "2026-08-15" }));
    shifts.push({ id: "past-final", course_id: "c1004", driver_id: "d1004", shift_date: "2026-08-15" });
    // 別会社と期間外の行はページングしても混ぜない。
    shifts.push({ id: "foreign-shift", course_id: "foreign-c", driver_id: "foreign-d", shift_date: "2026-08-15" });
    shifts.push({ id: "foreign-member", course_id: "c0", driver_id: "foreign-d", shift_date: "2026-08-15" });
    const requests = Array.from({ length: 1201 }, (_, i) => ({ id: `r${i}`, driver_id: "d1004", request_date: "2026-08-15" }));
    const tables: Record<string, Record<string, unknown>[]> = {
      courses: [...courses, { id: "foreign-c", org_id: "other" }],
      drivers: [...drivers, { id: "foreign-d", org_id: "other", works_as_driver: true }], shifts, shift_requests: requests,
    };
    m.from.mockImplementation((table: string) => query(table, tables[table] ?? []));
  };
  it("第2ページの終了者・廃止コースと第3ページの実績を保持する", async () => {
    setup();
    const response = await GET(new NextRequest("http://localhost/api/admin/shifts?start=2026-08-01&end=2026-08-15"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.drivers).toHaveLength(1005);
    expect(result.courses).toHaveLength(1005);
    expect(result.shifts).toHaveLength(2002);
    expect(result.requests).toHaveLength(1201);
    expect(result.shifts.find((s: any) => s.id === "past-final").drivers.id).toBe("d1004");
    expect(result.drivers.find((d: any) => d.id === "d1004").status).toBe("inactive");
    expect(result.courses.find((c: any) => c.id === "c1004").archived_at).toBe("2026-09-01");
    expect(m.filters).toContainEqual(["drivers", "range", 1000, 1999]);
    expect(m.filters).toContainEqual(["courses", "range", 1000, 1999]);
    expect(m.filters).toContainEqual(["shifts", "range", 2000, 2999]);
  });
  it("ダッシュボード件数も全ページから数え、別会社を除く", async () => {
    setup();
    const response = await GET(new NextRequest("http://localhost/api/admin/shifts?start=2026-08-01&end=2026-08-15&countDrivers=1"));
    expect(await response.json()).toEqual({ count: 1005 });
  });
  it("第2ページの失敗を部分成功として返さない", async () => {
    setup();
    m.failPage = true;
    const response = await GET(new NextRequest("http://localhost/api/admin/shifts?start=2026-08-01&end=2026-08-15"));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("drivers");
    m.failPage = false;
  });
});
