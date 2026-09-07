import { describe, expect, it } from "vitest";
import { parseParkingReport } from "./parking";

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
