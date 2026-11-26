import { describe, expect, it } from "vitest";
import { parseParkingReport, prepareParkingReport, writeParkingReport } from "./parking";

const ctx = { reportDate: "2026-09-07", itemVehicleIds: ["veh-1"], now: new Date("2026-09-07T18:00:00+09:00") };

describe("parseParkingReport", () => {
  it("登録車庫を選んだ申告を通す（日時は受信時刻が既定）", () => {
    const result = parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "place-1", slotId: "slot-1", clientKey: "k1" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.placeId).toBe("place-1");
      expect(result.value.slotId).toBe("slot-1");
      expect(result.value.at).toBe(ctx.now.toISOString());
    }
  });
  it("別の場所は場所名だけでも通す。空白だけの名前は拒否", () => {
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeName: "  近所のコインパーキング ", clientKey: "k" }, ctx)).toMatchObject({ ok: true, value: { placeName: "近所のコインパーキング", placeId: null } });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeName: "   ", clientKey: "k" }, ctx)).toMatchObject({ ok: false });
  });
  it("日報の使用車両と違う車両は拒否", () => {
    expect(parseParkingReport({ vehicleId: "veh-9", status: "parked", placeId: "p", clientKey: "k" }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining("一致しません") });
  });
  it("まだ使用中・引き渡した・あとで記録は場所なしで通り、場所の指定は捨てる", () => {
    for (const status of ["in_use", "handed_over", "later"] as const) {
      const result = parseParkingReport({ vehicleId: "veh-1", status, placeId: "place-1", clientKey: "k" }, ctx);
      expect(result).toMatchObject({ ok: true, value: { status, placeId: null } });
    }
  });
  it("区画だけの指定・長すぎる名前やメモ・不明な回答は拒否", () => {
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", slotId: "s", placeName: "x", clientKey: "k" }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeName: "あ".repeat(81), clientKey: "k" }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "p", note: "あ".repeat(201), clientKey: "k" }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "done", placeId: "p", clientKey: "k" }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "p" }, ctx)).toMatchObject({ ok: false });
  });
  it("駐車日時は対象日の前日0時から受信+5分まで。未来や古すぎる日時は拒否", () => {
    const ok = parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "p", clientKey: "k", at: "2026-09-06T05:00:00+09:00" }, ctx);
    expect(ok).toMatchObject({ ok: true, value: { at: new Date("2026-09-06T05:00:00+09:00").toISOString() } });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "p", clientKey: "k", at: "2026-09-05T23:00:00+09:00" }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "p", clientKey: "k", at: "2026-09-07T18:10:00+09:00" }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeId: "p", clientKey: "k", at: "not a date" }, ctx)).toMatchObject({ ok: false });
  });
});

describe("parseParkingReport の座標申告", () => {
  const coords = { lat: 34.78, lng: 135.47, accuracyM: 12, fixAt: "2026-09-07T17:55:00+09:00" };

  it("登録車庫も場所名も無くても、座標があれば parked を通す", () => {
    const result = parseParkingReport({ vehicleId: "veh-1", status: "parked", coords, detectedBy: "session_end", clientKey: "k" }, ctx);
    expect(result).toMatchObject({ ok: true, value: { placeId: null, placeName: null, detectedBy: "session_end" } });
    // 測位時刻が分かるときは、それを停めた時刻の既定にする
    if (result.ok) expect(result.value.at).toBe(new Date(coords.fixAt).toISOString());
  });

  it("場所も座標も無い parked は拒否", () => {
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", clientKey: "k" }, ctx)).toMatchObject({ ok: false });
  });

  it("座標のない取得方法は拒否（自動で取れた根拠にならない）", () => {
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", placeName: "路上", detectedBy: "stop", clientKey: "k" }, ctx)).toMatchObject({ ok: false });
  });

  it("範囲外の座標・不正な精度・未知の取得方法は拒否", () => {
    const base = { vehicleId: "veh-1", status: "parked" as const, clientKey: "k" };
    expect(parseParkingReport({ ...base, coords: { lat: 91, lng: 135.47 } }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ ...base, coords: { lat: 34.78, lng: 135.47, accuracyM: -1 } }, ctx)).toMatchObject({ ok: false });
    expect(parseParkingReport({ ...base, coords, detectedBy: "guess" as never }, ctx)).toMatchObject({ ok: false });
  });

  it("測位時刻が対象日の前日より前なら拒否", () => {
    const old = { ...coords, fixAt: "2026-09-01T10:00:00+09:00" };
    expect(parseParkingReport({ vehicleId: "veh-1", status: "parked", coords: old, clientKey: "k" }, ctx)).toMatchObject({ ok: false });
  });

  it("parked 以外は座標を捨てる（履歴に行を作らない回答）", () => {
    const result = parseParkingReport({ vehicleId: "veh-1", status: "in_use", coords, detectedBy: "session_end", clientKey: "k" }, ctx);
    expect(result).toMatchObject({ ok: true, value: { coords: null, detectedBy: null } });
  });
});

describe("PWAの駐車記録", () => {
  function parkingDb(loanDate: string, org: string) {
    const tables: Record<string, Record<string, unknown>[]> = {
      vehicles: [{ id: "shared-vehicle", owner_org_id: "owner" }],
      vehicle_loans: [{ vehicle_id: "shared-vehicle", borrower_org_id: org, loan_date: loanDate }],
    };
    const writes: {table: string; row: Record<string, unknown>}[] = [];
    const db = { from(table: string) {
      let rows = tables[table] ?? [];
      const q = {
        eq: (field: string, value: string) => { rows = rows.filter(row => row[field] === value); return q; },
        in: (field: string, values: string[]) => { rows = rows.filter(row => values.includes(String(row[field]))); return q; },
        select: () => q, then: (resolve: (value: unknown) => void) => Promise.resolve({ data: rows, error: null }).then(resolve),
        upsert: (row: Record<string, unknown>) => { writes.push({ table, row }); return q; },
        single: async () => ({ data: { id: "position" }, error: null }),
      };
      return q;
    } };
    return { db: db as unknown as Parameters<typeof prepareParkingReport>[0], writes };
  }
  const context = { orgId: "borrower", driverId: "test-driver", reportDate: "2026-11-23" };
  const input: NonNullable<Parameters<typeof prepareParkingReport>[1]> = {
    vehicleId: "shared-vehicle", status: "parked", placeId: null, slotId: null, placeName: null, note: null,
    at: "2026-11-23T11:37:00Z", coords: { lat: 34.7, lng: 135.5, accuracyM: null, fixAt: null }, detectedBy: null, clientKey: "same-key",
  };

  it("当日貸与車の手動ピンは借り側だけに保存し、所有車・自動検知を更新しない", async () => {
    const { db, writes } = parkingDb("2026-11-23", "borrower");
    const prepared = await prepareParkingReport(db, input, context, { requireMap: true });
    expect(await writeParkingReport(db, prepared)).toMatchObject({ saved: true });
    expect(writes).toEqual([{ table: "vehicle_positions", row: expect.objectContaining({
      org_id: "borrower", vehicle_id: "shared-vehicle", place_id: null, slot_id: null, lat: 34.7, lng: 135.5, at: "2026-11-23T11:37:00Z",
    }) }]);
    expect(writes[0].row).not.toHaveProperty("detected_by");
    expect(writes[0].row).not.toHaveProperty("accuracy_m");
  });
  it.each([["2026-11-22", "borrower"], ["2026-11-23", "unrelated"]])("貸与日の違いと他社の貸与を拒否する (%s, %s)", async (day, org) => {
    const { db, writes } = parkingDb(day, org);
    await expect(prepareParkingReport(db, input, context, { requireMap: true })).rejects.toThrow("この車両には駐車場所を記録できません");
    expect(writes).toHaveLength(0);
  });
});
