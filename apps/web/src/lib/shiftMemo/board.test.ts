import { describe, expect, it } from "vitest";
import { memoUnassignedPeople, paintMemoBackground, memoWorkDays, memoBackgroundColor, readBackgroundColors, activityLabel, cellKey, fullDayOffByDate, nextDayOverride, resolveDayActivity, readRequiredCountOverrides, resolveDayStaffing, updateRequiredCountOverride } from "./board";

const MON_TO_SAT = [1, 2, 3, 4, 5, 6];

describe("resolveDayActivity", () => {
  it("例外が無ければ曜日の設定どおり", () => {
    expect(resolveDayActivity(MON_TO_SAT, 3, undefined)).toEqual({ active: true, spot: false });
    expect(resolveDayActivity(MON_TO_SAT, 0, undefined)).toEqual({ active: false, spot: false });
  });

  it("稼働曜日をその日だけ休みにできる", () => {
    expect(resolveDayActivity(MON_TO_SAT, 3, "off")).toEqual({ active: false, spot: true });
  });

  it("非稼働の曜日をその日だけ動かせる", () => {
    expect(resolveDayActivity(MON_TO_SAT, 0, "on")).toEqual({ active: true, spot: true });
  });

  it("曜日の設定と同じ向きの例外は、例外として扱わない", () => {
    expect(resolveDayActivity(MON_TO_SAT, 3, "on")).toEqual({ active: true, spot: false });
    expect(resolveDayActivity(MON_TO_SAT, 0, "off")).toEqual({ active: false, spot: false });
  });
});

describe("nextDayOverride", () => {
  it("稼働日 → その日だけ休み → 元に戻る", () => {
    const off = nextDayOverride(MON_TO_SAT, 3, undefined);
    expect(off).toBe("off");
    expect(nextDayOverride(MON_TO_SAT, 3, off)).toBeUndefined();
  });

  it("非稼働日 → その日だけ稼働 → 元に戻る", () => {
    const on = nextDayOverride(MON_TO_SAT, 0, undefined);
    expect(on).toBe("on");
    expect(nextDayOverride(MON_TO_SAT, 0, on)).toBeUndefined();
  });

  it("曜日の設定を変えたあとに残った例外は、押すと消える", () => {
    // 日曜を稼働曜日に足したあと、「この日だけ稼働」の例外が残っている状態
    expect(nextDayOverride([...MON_TO_SAT, 0], 0, "on")).toBe("off");
  });
});

describe("activityLabel", () => {
  it("休みの理由が分かる文言を返す", () => {
    expect(activityLabel({ active: false, spot: false })).toBe("非稼働");
    expect(activityLabel({ active: false, spot: true })).toBe("臨時休");
    expect(activityLabel({ active: true, spot: true })).toBe("臨時稼働");
    expect(activityLabel({ active: true, spot: false })).toBeNull();
  });
});

describe("fullDayOffByDate", () => {
  it("全休だけを日付ごとにまとめる（便指定の休み希望は入れない）", () => {
    const map = fullDayOffByDate([
      { driver_id: "d1", request_date: "2026-09-11", slot_id: null },
      { driver_id: "d2", request_date: "2026-09-11", slot_id: "slot-1" },
      { driver_id: "d3", request_date: "2026-09-12", slot_id: null },
    ]);
    expect([...(map.get("2026-09-11") ?? [])]).toEqual(["d1"]);
    expect([...(map.get("2026-09-12") ?? [])]).toEqual(["d3"]);
    expect(map.has("2026-09-13")).toBe(false);
  });
});

describe("cellKey", () => {
  it("担当枠と日付を組にする", () => {
    expect(cellKey("lane-1", "2026-09-11")).toBe("lane-1|2026-09-11");
  });
});


describe("日別の必要人数", () => {
  it("旧データを読め、不正値だけ除いて別月や非表示の枠も保持する", () => {
    expect(readRequiredCountOverrides(undefined)).toEqual({});
    expect(readRequiredCountOverrides([3])).toEqual({});
    expect(readRequiredCountOverrides({
      "lane|2026-09-01": 0, "hidden|2026-10-01": 10,
      "lane|2026-09-02": "3", "lane|2026-09-03": 1.5,
      "lane|2026-09-04": -1, "lane|2026-09-05": 11, "lane|2026-09-06": null, broken: 3,
    })).toEqual({ "lane|2026-09-01": 0, "hidden|2026-10-01": 10 });
  });

  it("その日だけの絶対数を使い、通常の人数を変えても指定は動かない", () => {
    expect(resolveDayStaffing(2, undefined, true, 2)).toEqual({ requiredCount: 2, shortage: 0 });
    expect(resolveDayStaffing(2, 3, true, 2)).toEqual({ requiredCount: 3, shortage: 1 });
    expect(resolveDayStaffing(4, 3, true, 2)).toEqual({ requiredCount: 3, shortage: 1 });
  });

  it("0人・配置済みより少ない人数でも不足は0。休みから稼働へ戻すと指定人数で集計する", () => {
    expect(resolveDayStaffing(2, 0, true, 2)).toEqual({ requiredCount: 0, shortage: 0 });
    expect(resolveDayStaffing(2, 1, true, 2).shortage).toBe(0);
    expect(resolveDayStaffing(2, 3, false, 2)).toEqual({ requiredCount: 3, shortage: 0 });
    expect(resolveDayStaffing(2, 3, true, 2).shortage).toBe(1);
  });

  it("通常へ戻すとその日だけ解除し、通常と同じ人数の反映でも解除する", () => {
    const current = { "lane|2026-09-01": 3, "lane|2026-09-02": 4 };
    for (const wanted of [null, 2]) {
      const next = updateRequiredCountOverride(current, "lane|2026-09-01", 2, wanted);
      expect(next).toEqual({ "lane|2026-09-02": 4 });
      expect(resolveDayStaffing(2, next["lane|2026-09-01"], true, 2).requiredCount).toBe(2);
    }
    expect(current["lane|2026-09-01"]).toBe(3);
    expect(updateRequiredCountOverride(current, "lane|2026-09-01", 2, 0)["lane|2026-09-01"]).toBe(0);
    expect(updateRequiredCountOverride(current, "lane|2026-09-01", 2, 11)).toBe(current);
  });
});


describe("稼働日数と繁忙日の色", () => {
  it("複数枠・旧形式のキーでも同じドライバーは1日、休みと表示外期間は数えない", () => {
    const lanes=[{id:"am",activeWeekdays:[1,2,3,4,5,6]},{id:"pm",activeWeekdays:[1,2,3,4,5,6]}];
    const person={personKey:"legacy",driverId:"one",name:"甲"};
    const result=memoWorkDays(lanes,{
      "am|2026-10-19":[person],"pm|2026-10-19":[{...person,personKey:"driver:one"}],
      "am|2026-10-20":[person],"am|2026-10-21":[person],"am|2026-10-18":[person],
      "am|2026-11-01":[person],
    },["2026-10-18","2026-10-19","2026-10-20","2026-10-21"],{"am|2026-10-20":"off"});
    expect(result.get("driver:one")).toEqual({name:"甲",days:2});
  });
  it("日付優先、色なしの上書き、不正な保存値の除外", () => {
    const colors=readBackgroundColors({"weekday:1":"yellow","date:2026-10-19":"none","date:2026-10-20":"rose","weekday:9":"sky","date:2026-10-21":"red",arbitrary:"sky"});
    expect(Object.keys(colors)).toHaveLength(3);
    expect(memoBackgroundColor(colors,"2026-10-19")).toBe("#ffffff");
    expect(memoBackgroundColor(colors,"2026-10-26")).toBe("#fef3c7");
    expect(memoBackgroundColor(colors,"2026-10-20")).toBe("#ffe4e6");
  });
});


it("セル・行・列の交差を後から塗った色にし、範囲外を維持する", () => {
 const lanes=[{id:"a",routeId:"north"},{id:"b",routeId:"north"},{id:"c",routeId:"south"}];
 const dates=["2026-10-19","2026-10-20"];
 let colors=paintMemoBackground({},"row:a","sky",lanes,dates);
 colors=paintMemoBackground(colors,"date:2026-10-19","yellow",lanes,dates);
 expect(memoBackgroundColor(colors,dates[0],"a","north")).toBe("#fef3c7");
 expect(memoBackgroundColor(colors,dates[1],"a","north")).toBe("#dbeafe");
 colors=paintMemoBackground(colors,"cell:a|2026-10-19","rose",lanes,dates);
 expect(memoBackgroundColor(colors,dates[0],"a","north")).toBe("#ffe4e6");
 colors=paintMemoBackground(colors,"row:a","green",lanes,dates);
 expect(memoBackgroundColor(colors,dates[0],"a","north")).toBe("#dcfce7");
 expect(memoBackgroundColor(colors,dates[0],"b","north")).toBe("#fef3c7");
 colors=paintMemoBackground(colors,"course:north","violet",lanes,dates);
 expect(memoBackgroundColor(colors,dates[0],"a","north")).toBe("#ede9fe");
 expect(memoBackgroundColor(colors,dates[1],"b","north")).toBe("#ede9fe");
 expect(memoBackgroundColor(colors,dates[0],"c","south")).toBe("#fef3c7");
 colors=paintMemoBackground(colors,"cell:b|2026-10-20","none",lanes,dates);
 expect(memoBackgroundColor(colors,dates[1],"b","north")).toBe("#ffffff");
 colors=paintMemoBackground(colors,"cell:b|2026-10-20",null,lanes,dates);
 expect(memoBackgroundColor(colors,dates[1],"b","north")).toBe("#ede9fe");
});

describe("非稼働の名前札", () => {
  it("非表示の名前を除き、非表示枠・休みの枠にも配置済みなら重ねず、旧キーも同じドライバーとして扱う", () => {
    const candidates = [
      { personKey: "driver:a", driverId: "a" },
      { personKey: "driver:b", driverId: "b" },
      { personKey: "driver:hidden", driverId: "hidden" },
      { personKey: "custom:応援" },
      { personKey: "custom:非表示" },
    ];
    const result = memoUnassignedPeople(candidates, [{ id: "normal" }, { id: "hidden-or-off" }], {
      "hidden-or-off|2026-10-19": [{ personKey: "legacy:a", driverId: "a" }],
      "normal|2026-10-20": [{ personKey: "custom:応援" }],
      "removed-lane|2026-10-19": [{ personKey: "driver:b", driverId: "b" }],
    }, ["2026-10-19", "2026-10-20"], { "driver:hidden": true, "custom:非表示": true });
    expect(result.get("2026-10-19")).toEqual([candidates[1], candidates[3]]);
    expect(result.get("2026-10-20")).toEqual([candidates[0], candidates[1]]);
  });
});
