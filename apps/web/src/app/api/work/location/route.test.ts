import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  parked: null as { id: string } | null,
  laterParked: null as { id: string } | null,
  upsert: vi.fn(async (_rows: unknown, _options?: unknown) => ({ error: null })),
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/server/db/tenant", () => ({
  requireTenant: vi.fn(async () => ({ orgId: "org-1", user: { driverId: "driver-1" } })),
}));
vi.mock("@/server/db/client", () => ({
  supabase: {
    from: (table: string) => ({
      later: false,
      select() { return this; },
      eq(column: string, value: unknown) { db.filters.push([table, column, value]); return this; },
      gte() { this.later = true; return this; },
      order() { return this; },
      limit() { return this; },
      async maybeSingle() { return { data: table === "vehicle_sessions" ? db.session : this.later ? db.laterParked : db.parked, error: null }; },
      upsert: db.upsert,
    }),
  },
}));

import { GET, POST } from "./route";

const sessionId = "00000000-0000-4000-8000-000000000001";
const point = () => ({ lat: 34.78, lng: 135.47, accuracyM: 12, at: new Date().toISOString() });
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/work/location", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
}));

beforeEach(() => {
  db.session = { id: sessionId, vehicle_id: "vehicle-1", purpose: "work", status: "closed", started_at: new Date(Date.now() - 3600_000).toISOString(), ended_at: new Date(Date.now() - 60_000).toISOString() };
  db.parked = null;
  db.laterParked = null;
  db.upsert.mockClear();
  db.filters.length = 0;
});

describe("稼働中から駐車完了までの位置更新", () => {
  it("本人の終了済みセッションでは複数の測位を保存する", async () => {
    const response = await post({ sessionId, positions: [point(), point()] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tracking: true });
    expect(db.filters).toContainEqual(["vehicle_sessions", "org_id", "org-1"]);
    expect(db.filters).toContainEqual(["vehicle_sessions", "recorded_by", "driver-1"]);
    expect(db.upsert).toHaveBeenCalledOnce();
    const rows = db.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ org_id: "org-1", vehicle_id: "vehicle-1", source: "gps", kind: "observation" });
  });

  it("駐車が記録された後は保存せず停止を返す", async () => {
    db.parked = { id: "parked-1" };
    const response = await post({ sessionId, positions: [point()] });
    expect(await response.json()).toEqual({ tracking: false });
    expect(db.upsert).not.toHaveBeenCalled();
    const check = await GET(new NextRequest(`http://localhost/api/work/location?sessionId=${sessionId}`));
    expect(await check.json()).toEqual({ tracking: false });
  });

  it("後から日報で駐車を記録した場合も停止を返す", async () => {
    db.laterParked = { id: "report-parked" };
    const response = await post({ sessionId, positions: [point()] });
    expect(await response.json()).toEqual({ tracking: false });
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("測位値が不正な場合と本人のセッションがない場合は記録しない", async () => {
    expect((await post({ sessionId, positions: [{ ...point(), lat: null }] })).status).toBe(400);
    db.session = null;
    expect((await post({ sessionId, positions: [point()] })).status).toBe(404);
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
