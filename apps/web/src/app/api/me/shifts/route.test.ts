// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), slots: vi.fn(), filters: [] as unknown[][], results: {} as Record<string, { data: any[] | null; error: unknown }> }));
vi.mock("@/server/auth", () => ({ requireScopedPermission: m.auth, isAuthError: (x: unknown) => x instanceof NextResponse }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/shiftSlots/config", () => ({ loadDriverSlots: m.slots }));
import { GET } from "./route";
const request = () => new NextRequest("http://localhost/api/me/shifts?start=2026-09-01&end=2026-09-30&driver_id=other");
beforeEach(() => {
  vi.resetAllMocks(); m.filters = [];
  m.auth.mockResolvedValue({ driverId: "self" }); m.slots.mockResolvedValue([{ id: "pm", name: "午後便" }]);
  m.results = {
    shifts: { error: null, data: [{ shift_date: "2026-09-02", slot: 1, cycle_no: 2, vehicle_id: "van", meeting_time: "06:30", end_time: null, courses: { name: "省略しない正式コース名", summary_title: "略名", meeting_time: "08:00", end_time: "19:00", meeting_place: "コース集合場所", course_cycles: [{ cycle_no: 2, label: "午後便", meeting_time: "09:00", end_time: "18:00", meeting_place: null }] } }] },
    vehicles: { error: null, data: [{ id: "van", plate_color: "yellow", number_numeric: "1234" }] },
    shift_requests: { error: null, data: [{ request_date: "2026-09-03", slot_id: null }, { request_date: "2026-09-02", slot_id: "pm" }] },
  };
  m.from.mockImplementation((table: string) => {
    const q: any = {};
    for (const method of ["select", "eq", "gte", "lte", "order", "in"]) q[method] = (...args: unknown[]) => { m.filters.push([table, method, ...args]); return q; };
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(m.results[table]).then(resolve);
    return q;
  });
});
it("本人だけを読み、正式名と時刻の上書き優先順・便・プレート色を返す", async () => {
  const data = await (await GET(request())).json();
  expect(data.shifts[0]).toMatchObject({ course_name: "略名", course_full_name: "省略しない正式コース名", meeting_time: "06:30", end_time: "18:00", meeting_place: "コース集合場所", cycle_label: "午後便", vehicle: { plate_color: "yellow" } });
  expect(m.filters).toContainEqual(["shifts", "eq", "driver_id", "self"]);
  expect(m.filters).toContainEqual(["shift_requests", "eq", "driver_id", "self"]);
  expect(m.filters).toContainEqual(["vehicles", "in", "id", ["van"]]);
  expect(data.rest_days).toEqual([{ date: "2026-09-03", kind: "requested", slot_label: null }, { date: "2026-09-02", kind: "requested", slot_label: "午後便" }]);
});
it("希望休取得失敗を休みなしに見せず、車両取得失敗を未割当にしない", async () => {
  m.results.shift_requests = { data: null, error: new Error("offline") };
  m.results.vehicles = { data: null, error: new Error("offline") };
  const data = await (await GET(request())).json();
  expect(data.rest_days_unavailable).toBe(true);
  expect(data.shifts[0]).toMatchObject({ vehicle: null, vehicle_unavailable: true });
});
it("便名を取得できなくても部分希望休を全休へ変換しない", async () => {
  m.slots.mockRejectedValue(new Error("offline"));
  const data = await (await GET(request())).json();
  expect(data.rest_days[1].slot_label).toBe("一部の便");
});
it("認可失敗ならDBに触れない", async () => {
  m.auth.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  expect((await GET(request())).status).toBe(401); expect(m.from).not.toHaveBeenCalled();
});
