// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, calls: vi.fn(), prepare: vi.fn(), write: vi.fn(), rpc: vi.fn(), lease: vi.fn(), auth: true }));
vi.mock("@/server/auth", () => ({ requireAuth: async () => m.auth ? { driverId: "self" } : NextResponse.json({ error: "Unauthorized" }, { status: 401 }), isAuthError: (v: unknown) => v instanceof NextResponse }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org" }));
vi.mock("@/server/db/client", () => ({ supabase: {
  rpc: m.rpc,
  from: (table: string) => {
    let rows = m.rows[table] ?? [];
    const q = {
      select: () => q,
      eq: (col: string, value: unknown) => { m.calls(table, col, value); rows = rows.filter(row => row[col] === value); return q; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    };
    return q;
  },
} }));
vi.mock("@/server/billing/driverLease", () => ({ loadDriverLease: m.lease }));
vi.mock("@/server/reports/parking", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/reports/parking")>(), prepareParkingReport: m.prepare, writeParkingReport: m.write,
}));

import { GET, POST } from "./route";
import { supabase } from "@/server/db/client";
import { chooseParkingStage, reportParkingPositionKey } from "@/server/reports/postSubmitParking";

const date = "2026-11-16";
const vehicle = "12345678-0000-4000-8000-000000000002";
const otherVehicle = "12345678-0000-4000-8000-000000000003";
const owner = { orgId: "org", driverId: "self" };
const add = (key: string, stage: "required" | "not_required", driverId = "self", orgId = "org") =>
  ({ client_key: key, driver_id: driverId, org_id: orgId, payload: { date, items: [{ vehicleId: vehicle, _pwaParkingStage: stage }] } });
const url = "http://localhost/api/reports/v2/parking";
const req = (key: string, data?: unknown) => new NextRequest(data ? url : url + "?key=" + key, data ? { method: "POST", body: JSON.stringify({ receiptKey: key, parking: data, orgId: "ignore-client", reportDate: "2099-01-01" }) } : {});
const pin = { vehicleId: vehicle, status: "parked", coords: { lat: 34.7, lng: 135.5 }, at: "2026-11-16T19:00:00+09:00" };

beforeEach(() => {
  vi.resetAllMocks();
  m.auth = true;
  m.rows = { report_submission_receipts: [add("mine", "required"), add("monthly", "not_required"), add("peer", "required", "somebody"), add("other-org", "required", "self", "other")], vehicle_positions: [] };
  m.prepare.mockResolvedValue({ row: { fixture: true } });
  m.write.mockResolvedValue({ saved: true });
});

describe("保存済み日報の駐車", () => {
  it("日報本人と同じ組織以外の控えは読み出さず、書き込まない", async () => {
    for (const key of ["peer", "other-org", "never"]) {
      expect(await (await GET(req(key))).json()).toEqual({ stage: "not_found" });
      expect((await POST(req(key, pin))).status).toBe(404);
    }
    m.auth = false;
    expect((await GET(req("mine"))).status).toBe(401);
    expect(m.prepare).not.toHaveBeenCalled();
  });

  it("未記録から同じ控えで駐車だけ記録し、完了後の再送は上書きしない", async () => {
    expect(await (await GET(req("mine"))).json()).toMatchObject({ stage: "required", reportDate: date, vehicleId: vehicle });
    expect((await POST(req("mine", pin))).status).toBe(200);
    expect(m.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vehicleId: vehicle, clientKey: reportParkingPositionKey(owner, "mine") }), { ...owner, reportDate: date }, { requireMap: true });
    expect(m.write).toHaveBeenCalledWith(expect.anything(), expect.anything(), { once: true });
    expect(m.rpc).not.toHaveBeenCalled();
    m.rows.vehicle_positions = [{ id: "p", org_id: "org", driver_id: "self", report_date: date, vehicle_id: vehicle, client_key: reportParkingPositionKey(owner, "mine") }];
    expect(await (await GET(req("mine"))).json()).toMatchObject({ stage: "complete" });
    expect((await POST(req("mine", { ...pin, at: pin.at, coords: { ...pin.coords, lat: 0 } }))).status).toBe(200);
    expect(m.write).toHaveBeenCalledTimes(1);
  });

  it("月額の控え、車両違い、旧スキップ、座標のない場所名、過去時刻省略を拒否する", async () => {
    expect((await POST(req("monthly", pin))).status).toBe(409);
    for (const value of [
      { ...pin, vehicleId: otherVehicle },
      { ...pin, status: "later" },
      { ...pin, coords: null, placeName: "名前のみ" },
      { ...pin, at: undefined },
    ]) expect((await POST(req("mine", value))).status).toBe(400);
    expect(m.prepare).not.toHaveBeenCalled();
  });

  it("月リースは報告日で判定し、車両なし・日額・不明を区別する。保存後の再送は当初の判定を使う", async () => {
    expect(await chooseParkingStage(supabase, owner, "no-vehicle", date, null)).toBe("not_required");
    expect(m.lease).not.toHaveBeenCalled();
    m.lease.mockResolvedValueOnce({ mode: "MONTHLY", amount: 43000 }).mockResolvedValueOnce({ mode: "DAILY", amount: 0 }).mockResolvedValueOnce(null);
    expect(await chooseParkingStage(supabase, owner, "first", date, vehicle)).toBe("not_required");
    expect(await chooseParkingStage(supabase, owner, "second", date, vehicle)).toBe("required");
    expect(await chooseParkingStage(supabase, owner, "unknown", date, vehicle)).toBe("required");
    expect(m.lease).toHaveBeenLastCalledWith(expect.anything(), "self", date, date);
    expect(await chooseParkingStage(supabase, owner, "monthly", date, vehicle)).toBe("not_required");
    expect(m.lease).toHaveBeenCalledTimes(3);
  });
});
