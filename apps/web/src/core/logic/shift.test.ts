import { describe, it, expect } from "vitest";
import {
  ALL,
  requestsToOffMap,
  periodFor,
  isLockedDate,
  dayOff,
  isWholeDayOff,
  hasAnyOff,
  toggleOffKey,
  hasOffChanges,
  buildOffEntries,
  type OffMap,
} from "./shift";
import type { ShiftRequest, PeriodInfo } from "@/core/types";

function req(date: string, slot_id: string | null): ShiftRequest {
  return { id: `${date}#${slot_id ?? ALL}`, driver_id: "d1", request_date: date, request_type: "off", slot_id };
}

const periods: PeriodInfo[] = [
  { seq: 1, label: "1〜15", deadline: "2026-05-25", closed: true, startDate: "2026-06-01", endDate: "2026-06-15" },
  { seq: 2, label: "16〜末", deadline: "2026-06-10", closed: false, startDate: "2026-06-16", endDate: "2026-06-30" },
];

describe("requestsToOffMap", () => {
  it("slot_id ありは slotId、null は ALL でグルーピング", () => {
    const m = requestsToOffMap([req("2026-06-20", "s1"), req("2026-06-20", "s2"), req("2026-06-21", null)]);
    expect(m.get("2026-06-20")).toEqual(new Set(["s1", "s2"]));
    expect(m.get("2026-06-21")).toEqual(new Set([ALL]));
  });
});

describe("periodFor / isLockedDate", () => {
  it("日付が属する期間を返す", () => {
    expect(periodFor(periods, "2026-06-10")?.seq).toBe(1);
    expect(periodFor(periods, "2026-06-16")?.seq).toBe(2);
  });
  it("どの期間にも属さなければ null・未ロック", () => {
    expect(periodFor(periods, "2026-07-01")).toBeNull();
    expect(isLockedDate(periods, "2026-07-01")).toBe(false);
  });
  it("closed 期間内はロック", () => {
    expect(isLockedDate(periods, "2026-06-10")).toBe(true);
    expect(isLockedDate(periods, "2026-06-20")).toBe(false);
  });
});

describe("dayOff helpers", () => {
  const off: OffMap = new Map([
    ["2026-06-20", new Set([ALL])],
    ["2026-06-21", new Set(["s1"])],
  ]);
  it("dayOff は無い日に空集合", () => {
    expect(dayOff(off, "2026-06-01")).toEqual(new Set());
  });
  it("isWholeDayOff / hasAnyOff", () => {
    expect(isWholeDayOff(off, "2026-06-20")).toBe(true);
    expect(isWholeDayOff(off, "2026-06-21")).toBe(false);
    expect(hasAnyOff(off, "2026-06-21")).toBe(true);
    expect(hasAnyOff(off, "2026-06-01")).toBe(false);
  });
});

describe("toggleOffKey（全休と便は排他・不変）", () => {
  it("元の Map を変更しない", () => {
    const off: OffMap = new Map();
    const next = toggleOffKey(off, "2026-06-20", "s1");
    expect(off.size).toBe(0);
    expect(next.get("2026-06-20")).toEqual(new Set(["s1"]));
  });
  it("便を追加→再トグルで削除、空なら日付ごと消える", () => {
    let off: OffMap = new Map();
    off = toggleOffKey(off, "2026-06-20", "s1");
    off = toggleOffKey(off, "2026-06-20", "s1");
    expect(off.has("2026-06-20")).toBe(false);
  });
  it("ALL を入れると便はクリアされ全休になる", () => {
    let off: OffMap = new Map([["2026-06-20", new Set(["s1", "s2"])]]);
    off = toggleOffKey(off, "2026-06-20", ALL);
    expect(off.get("2026-06-20")).toEqual(new Set([ALL]));
  });
  it("全休状態で便を選ぶと ALL が外れ便だけになる", () => {
    let off: OffMap = new Map([["2026-06-20", new Set([ALL])]]);
    off = toggleOffKey(off, "2026-06-20", "s1");
    expect(off.get("2026-06-20")).toEqual(new Set(["s1"]));
  });
  it("ALL 再トグルで解除", () => {
    let off: OffMap = new Map([["2026-06-20", new Set([ALL])]]);
    off = toggleOffKey(off, "2026-06-20", ALL);
    expect(off.has("2026-06-20")).toBe(false);
  });
});

describe("hasOffChanges", () => {
  const requests = [req("2026-06-20", "s1"), req("2026-06-21", null)];
  it("サーバと一致なら false", () => {
    const off: OffMap = new Map([
      ["2026-06-20", new Set(["s1"])],
      ["2026-06-21", new Set([ALL])],
    ]);
    expect(hasOffChanges(requests, off)).toBe(false);
  });
  it("件数が違えば true", () => {
    const off: OffMap = new Map([["2026-06-20", new Set(["s1"])]]);
    expect(hasOffChanges(requests, off)).toBe(true);
  });
  it("件数同じでもキーが違えば true", () => {
    const off: OffMap = new Map([
      ["2026-06-20", new Set(["s2"])],
      ["2026-06-21", new Set([ALL])],
    ]);
    expect(hasOffChanges(requests, off)).toBe(true);
  });
});

describe("buildOffEntries", () => {
  const off: OffMap = new Map([
    ["2026-06-20", new Set(["s1", ALL])], // ALL → slotId:null
    ["2026-06-10", new Set(["s1"])], // ロック期間 → 除外
    ["2026-07-01", new Set(["s1"])], // 当月外 → 除外
  ]);
  it("当月かつ未ロックのみ・ALL は slotId:null に変換", () => {
    const out = buildOffEntries(off, "2026-06", periods);
    expect(out).toContainEqual({ date: "2026-06-20", slotId: "s1" });
    expect(out).toContainEqual({ date: "2026-06-20", slotId: null });
    expect(out.some((e) => e.date === "2026-06-10")).toBe(false);
    expect(out.some((e) => e.date === "2026-07-01")).toBe(false);
  });
});
