import { describe, expect, it } from "vitest";
import { exportShiftMemo, exportShiftMemoCsv, parseShiftMemoTransfer, type ShiftMemoBoardData } from "./transfer";

const board: ShiftMemoBoardData = {
  version: 1,
  lanes: [{ id: "lane-1", routeId: "course-1", name: "第二区域", color: "#123456", activeWeekdays: [1, 2, 3], requiredCount: 2, custom: true, reflectCourseId: "course-2" }],
  laneOrder: ["lane-1"], hiddenLaneIds: [], routeOrder: ["course-1"], hiddenRouteIds: [],
  assignments: { "lane-1|2026-10-01": [
    { placementId: "one", personKey: "driver:driver-1", driverId: "driver-1", name: "甲" },
    { placementId: "two", personKey: "custom:乙", name: "乙" },
  ] },
  extraPeople: ["乙"], notes: { "2026-10-01": "確認中" },
  dayOverrides: { "lane-1|2026-10-02": "off" }, requiredCountOverrides: { "lane-1|2026-10-01": 3 },
  widths: { day: 76, lane: 190, detail: 330 },
};
const context = { courseIds: ["course-1", "course-2"], driverIds: ["driver-1"] };

describe("シフトメモの端末間受け渡し", () => {
  it("自作行・反映先・配置・未登録の名前札を欠かさず戻す", () => {
    const result = parseShiftMemoTransfer(exportShiftMemo(board), context);
    expect(result.board).toEqual(board);
    expect(result.placementCount).toBe(2);
    expect(result.unregisteredNames).toEqual(["乙"]);
  });

  it("登録がなくなった人は名前札として残す", () => {
    const result = parseShiftMemoTransfer(exportShiftMemo(board), { ...context, driverIds: [] });
    expect(result.board.assignments["lane-1|2026-10-01"][0]).toEqual({ placementId: "one", personKey: "driver:driver-1", name: "甲" });
    expect(result.unregisteredNames).toEqual(["甲", "乙"]);
  });

  it("元のコースの必要人数が10人を超えても受け取れる", () => {
    const larger = { ...board, lanes: [{ ...board.lanes[0], requiredCount: 12 }] };
    expect(parseShiftMemoTransfer(exportShiftMemo(larger), context).board.lanes[0].requiredCount).toBe(12);
  });

  it("別会社のコースと壊れたファイルを拒否する", () => {
    expect(() => parseShiftMemoTransfer(exportShiftMemo(board), { ...context, courseIds: ["other"] })).toThrow("現在使えないコース");
    expect(() => parseShiftMemoTransfer("{}", context)).toThrow("ハコ虎のシフトメモデータ");
    expect(() => parseShiftMemoTransfer("{", context)).toThrow("読み取れません");
  });

  it("CSVを日本語列名・BOM付きで出し、備考の引用符を壊さない", () => {
    const csv = exportShiftMemoCsv({ ...board, notes: { "2026-10-01": '確認 "中"' } }, [{ id: "course-1", name: "第一区域" }]);
    expect(csv).toContain('"2026-10-01","第一区域","第二区域","甲","3","確認 ""中"""');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const visible = exportShiftMemoCsv(board, [{ id: "course-1", name: "第一区域" }], ["2026-10-02"]);
    expect(visible).toContain('"2026-10-02","第一区域","第二区域","","2",""');
    expect(visible).toContain('"2026-10-01","第一区域","第二区域","甲","3","確認中"');
  });
});
