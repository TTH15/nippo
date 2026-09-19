// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// shifts は org_id 列を持たず、shift_requests / shift_request_logs は migration 174 で
// 足したばかり（移行中は NULL の行もありうる）。どちらも列だけでは守れないので、
// 呼び出し側が自社のコース・ドライバーかを確かめる必要がある。
// 2026-09-18 に3本のルートで抜けていたのを塞いだので、ここで固定する。
const m = vi.hoisted(() => ({ from: vi.fn(), belongs: vi.fn(), logs: vi.fn(), actor: vi.fn() }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/server/auth", () => ({
  requirePermission: async () => ({ driverId: "actor", orgId: "org-1", capabilities: new Set() }),
  isAuthError: () => false,
}));
vi.mock("@/server/db/adminResourceScope", () => ({
  adminMutationError: () => new Response(JSON.stringify({ error: "db" }), { status: 500 }),
  belongsToOrg: m.belongs,
  isDateOnly: (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  isUuid: (v: unknown) => typeof v === "string" && v.length > 0,
}));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-1" }));
vi.mock("@/server/shiftRequests/log", () => ({ insertShiftRequestLogs: m.logs, fetchActorName: m.actor }));
vi.mock("@/server/shiftSlots/timeInput", () => ({
  normalizeTimeInput: (v: unknown) => v ?? null,
  normalizePlaceInput: (v: unknown) => v ?? null,
}));

import { POST as postTimes } from "@/app/api/admin/shifts/times/route";
import { DELETE as deleteRequest } from "@/app/api/admin/shifts/requests/[id]/route";
import { GET as getHistory } from "@/app/api/admin/shifts/requests/history/route";
import { DELETE as deleteCourse } from "@/app/api/admin/courses/[id]/route";

const OTHER_COURSE = "99999999-9999-4999-8999-999999999999";
const OTHER_DRIVER = "88888888-8888-4888-8888-888888888888";

function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "update", "delete", "eq", "order"]) chain[key] = () => chain;
  chain.maybeSingle = async () => result;
  chain.then = undefined;
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue("運営");
});

describe("他社のシフト時刻を書き換えられない", () => {
  const body = { shiftDate: "2026-09-25", courseId: OTHER_COURSE, slot: 1, meetingTime: "07:00" };
  const post = () =>
    postTimes(new NextRequest("http://localhost/api/admin/shifts/times", { method: "POST", body: JSON.stringify(body) }));

  it("自社のコースでなければ 404 で止め、DB を触らない", async () => {
    m.belongs.mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
    expect(m.belongs).toHaveBeenCalledWith("courses", OTHER_COURSE, "org-1");
  });

  it("自社のコースなら従来どおり更新する", async () => {
    m.belongs.mockResolvedValue(true);
    m.from.mockReturnValue(builder({ data: { id: "row-1" }, error: null }));
    expect((await post()).status).toBe(200);
  });
});

describe("他社の希望休を消せない", () => {
  const del = () =>
    deleteRequest(new NextRequest("http://localhost/api/admin/shifts/requests/req-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "req-1" }),
    });

  it("他社のドライバーの希望休なら 404 で止め、削除しない", async () => {
    let deleted = false;
    m.from.mockImplementation((table: string) => {
      if (table === "shift_requests") {
        const chain = builder({ data: { driver_id: OTHER_DRIVER, request_date: "2026-09-25", slot_id: null }, error: null });
        chain.delete = () => {
          deleted = true;
          return chain;
        };
        return chain;
      }
      return builder({ data: null, error: null });
    });
    m.belongs.mockResolvedValue(false);
    const res = await del();
    expect(res.status).toBe(404);
    expect(deleted).toBe(false);
    expect(m.logs).not.toHaveBeenCalled();
  });

  it("存在しない id も 404（削除の空振りを成功にしない）", async () => {
    m.from.mockReturnValue(builder({ data: null, error: null }));
    expect((await del()).status).toBe(404);
    expect(m.belongs).not.toHaveBeenCalled();
  });
});

describe("他社の希望休の履歴を読めない", () => {
  const get = (driverId: string) =>
    getHistory(new NextRequest(`http://localhost/api/admin/shifts/requests/history?driverId=${driverId}&date=2026-09-25`));

  it("自社のドライバーでなければ 404 で止め、ログを読まない", async () => {
    m.belongs.mockResolvedValue(false);
    const res = await get(OTHER_DRIVER);
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
  });

  it("自社のドライバーなら従来どおり返す", async () => {
    m.belongs.mockResolvedValue(true);
    m.from.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    });
    expect((await get("own-driver")).status).toBe(200);
  });
});

// コース削除は関連レコード（担当・単価・シフト）を course_id だけを条件に消す。
// 自社のコースかを先に確かめないと、他社のコースIDを渡すだけで中身を消せてしまう。
// courses 自体は .eq("org_id") で守られるため、コースだけ残って履歴が消える形になる。
describe("他社のコースの関連レコードを消せない", () => {
  const del = (id: string) =>
    deleteCourse(new NextRequest(`http://localhost/api/admin/courses/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });

  it("自社のコースでなければ 404 で止め、DB を触らない", async () => {
    m.belongs.mockResolvedValue(false);
    const res = await del(OTHER_COURSE);
    expect(res.status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
    expect(m.belongs).toHaveBeenCalledWith("courses", OTHER_COURSE, "org-1");
  });

  it("自社のコースなら関連レコードごと削除する", async () => {
    m.belongs.mockResolvedValue(true);
    const deleted: string[] = [];
    m.from.mockImplementation((table: string) => {
      const chain = builder({ data: null, error: null });
      chain.delete = () => {
        deleted.push(table);
        return chain;
      };
      chain.eq = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
      return chain;
    });
    expect((await del("own-course")).status).toBe(200);
    expect(deleted).toEqual(["driver_courses", "course_rates", "shifts", "courses"]);
  });
});
