import { describe, expect, it } from "vitest";
import { activityLabel, cellKey, fullDayOffByDate, nextDayOverride, resolveDayActivity } from "./board";

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
