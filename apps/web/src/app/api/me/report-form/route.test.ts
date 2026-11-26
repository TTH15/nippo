// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  filter: vi.fn(),
  from: vi.fn(),
  failing: false,
}));
vi.mock("@/server/auth", () => ({ requireAuth: async () => ({ driverId: "self" }), isAuthError: (x: unknown) => x instanceof NextResponse }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
vi.mock("@/server/reports/courseReportFields", () => ({ loadCourseReportFields: async () => ({ allows: () => true }) }));
vi.mock("@/server/db/client", () => ({ supabase: {
  rpc: async () => ({ data: "revision", error: null }),
  from: (table: string) => {
    mock.from(table);
    let rows = mock.rows[table] ?? [];
    const q = {
      select: () => q,
      eq: (col: string, value: unknown) => { mock.filter(table, col, value); rows = rows.filter(row => row[col] === value); return q; },
      in: (col: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[col])); return q; },
      lte: () => q,
      or: () => q,
      order: () => q,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: rows, error: table === "driver_courses" && mock.failing ? {} : null }).then(resolve),
    };
    return q;
  },
} }));
import { GET } from "./route";
const date = "2026-11-24";
const request = (suffix = "&candidates=1") => new NextRequest("http://localhost/api/me/report-form?date=" + date + suffix);
const course = (id: string, org_id = "org", uses_cycles = true, archived_at: null | string = null) => ({
  id, name: id, org_id, uses_cycles, archived_at,
  course_cycles: [{ cycle_no: 1, label: "午前", active: true }, { cycle_no: 2, label: null, active: true }, { cycle_no: 3, label: "停止", active: false }],
});
const shift = (course_id: string) => ({ course_id, cycle_no: 1, driver_id: "self", shift_date: date });
const link = (course_id: string, cycle_no: number, driver = "self") => ({ course_id, cycle_no, "driver_identities.driver_id": driver });
beforeEach(() => {
  vi.clearAllMocks();
  mock.failing = false;
  mock.rows = {
    courses: [course("全便"), course("午後のみ"), course("未紐付けシフト"), course("以前の申請"), course("別人のみ"), course("他社", "other"), course("終了", "org", false, date), course("便なし", "org", false), course("旧報告")],
    driver_courses: [link("全便", 0), link("午後のみ", 2), link("午後のみ", 2), link("別人のみ", 0, "peer"), link("他社", 0), link("終了", 0), link("便なし", 0), link("旧報告", 0)],
    shifts: [shift("全便"), shift("未紐付けシフト"), shift("旧報告")],
    report_course_requests: [{ org_id: "org", driver_id: "self", report_date: date, status: "pending", course_id: "以前の申請", cycle_no: 1, id: "q", payload: { entries: [{ unitId: "unit", fieldKey: "n", valueNum: 42 }] } }],
    daily_reports_v2: [{ driver_id: "self", report_date: date, course_id: "旧報告", cycle_no: 0, id: "r", rejected_at: null }],
  };
});

it("本人の担当便だけを返し、当日シフト・過去申請から未紐付けの別便を漏らさない", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(mock.filter).toHaveBeenCalledWith("driver_courses", "driver_identities.driver_id", "self");
  expect(mock.filter).toHaveBeenCalledWith("courses", "org_id", "org");
  expect(result.candidates.map((c: { courseId: string; cycleNo: number; cycleLabel: string | null }) => [c.courseId, c.cycleNo, c.cycleLabel])).toEqual([
    ["全便", 2, "C2"], ["午後のみ", 2, "C2"], ["便なし", 0, null],
  ]);
  expect(result.shifts).toEqual(expect.arrayContaining([
    expect.objectContaining({ courseId: "未紐付けシフト", cycleNo: 1 }),
    expect.objectContaining({ courseId: "以前の申請", cycleNo: 1, requestId: "q", existing: expect.objectContaining({ values: { unit: { n: 42 } } }) }),
    expect.objectContaining({ courseId: "旧報告", cycleNo: 0, existing: expect.objectContaining({ reportId: "r" }) }),
  ]));
});

it("担当登録がない場合や旧/モバイルクライアントでも当日シフトは残る", async () => {
  mock.rows.driver_courses = [];
  const response = await GET(request());
  expect(await response.json()).toMatchObject({ shifts: expect.arrayContaining([expect.objectContaining({ courseId: "未紐付けシフト" })]), candidates: [] });
  mock.from.mockClear();
  expect(await (await GET(request(""))).json()).not.toHaveProperty("candidates");
  expect(mock.from).not.toHaveBeenCalledWith("driver_courses");
});

it("担当登録が読み取れない場合に全コースを返さない", async () => {
  mock.failing = true;
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("candidates");
});


it.each([["MONTHLY", false], ["DAILY", true]])("日報フォームは%s契約の車両返却要否を返す", async (mode, required) => {
  mock.rows.driver_leases = [{ driver_id: "self", mode, amount: 10000, valid_from: date }];
  const response = await GET(request("&candidates=1&parkingPolicy=post_submit_map"));
  expect(await response.json()).toHaveProperty("vehicleReturnRequired", required);
});
