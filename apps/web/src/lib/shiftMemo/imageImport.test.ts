import { describe, expect, it } from "vitest";
import { imageRowDefaultTarget, mergeImageMemoRead, parseImageMemoRead } from "./imageImport";
import type { ShiftMemoBoardData } from "./transfer";

const lanes = [{ id: "lane-1", routeId: "course-1", name: "豊中", color: "#123456", activeWeekdays: [1, 2], requiredCount: 1, custom: false }];
const board: ShiftMemoBoardData = { version: 1, lanes, laneOrder: ["lane-1"], hiddenLaneIds: [],
  assignments: { "lane-1|2026-09-16": [{ placementId: "old", personKey: "custom:旧", name: "旧" }],
    "lane-1|2026-09-18": [{ placementId: "keep", personKey: "custom:維持", name: "維持" }] },
  extraPeople: ["旧"], notes: {}, routeOrder: [], hiddenRouteIds: [] };
const courses = [{ id: "course-1", name: "豊中", color: "#123456" }, { id: "course-2", name: "吹田", color: "#abcdef" }];
const drivers = [{ id: "driver-1", name: "佐藤 翔太" }];
const raw = { period: { year: 2026, month: 9 }, rows: [
  { name: "豊中", days: [{ day: 16, names: ["佐藤 翔太", "応援"] }] },
  { name: "臨時", days: [{ day: 17, names: ["外部"] }] },
], warnings: [] };

describe("画像・PDFから個人メモへの読み込み", () => {
  it("異なる月、重複日付、壊れた名前を拒否する", () => {
    expect(() => parseImageMemoRead(raw, { year: 2026, month: 10 })).toThrow("一致しません");
    expect(() => parseImageMemoRead({ ...raw, rows: [{ name: "豊中", days: [raw.rows[0].days[0], raw.rows[0].days[0]] }] }, raw.period)).toThrow("日付と名前");
    expect(() => parseImageMemoRead({ ...raw, rows: [{ name: "豊中", days: [{ day: 16, names: [""] }] }] }, raw.period)).toThrow("日付と名前");
  });

  it("一致する枠を提案し、未登録者は名前札のまま残して対象セルだけ置き換える", () => {
    const read = parseImageMemoRead(raw, raw.period);
    expect(imageRowDefaultTarget("豊中", lanes, courses)).toBe("lane:lane-1");
    expect(imageRowDefaultTarget("臨時", lanes, courses)).toBe("");
    const merged = mergeImageMemoRead(board, read, ["lane:lane-1", "course:course-2"], courses, drivers);
    expect(merged.assignments["lane-1|2026-09-16"].map(person => person.name)).toEqual(["佐藤 翔太", "応援"]);
    expect(merged.assignments["lane-1|2026-09-16"][0].driverId).toBe("driver-1");
    expect(merged.assignments["lane-1|2026-09-16"][1].driverId).toBeUndefined();
    expect(merged.assignments["lane-1|2026-09-18"]).toEqual(board.assignments["lane-1|2026-09-18"]);
    expect(merged.lanes.at(-1)).toMatchObject({ name: "臨時", routeId: "course-2", custom: true });
    expect(merged.extraPeople).toContain("外部");
    expect(board.assignments["lane-1|2026-09-16"][0].name).toBe("旧");
  });

  it("読み込み先未選択では既存メモを変えない", () => {
    const read = parseImageMemoRead(raw, raw.period);
    expect(() => mergeImageMemoRead(board, read, ["lane:lane-1", ""], courses, drivers)).toThrow("反映先");
    expect(board.lanes).toHaveLength(1);
    expect(() => mergeImageMemoRead(board, read, ["skip", "skip"], courses, drivers)).toThrow("読み込む担当枠");
  });

  it("同じセルへ複数行を重ねて消さない", () => {
    const read = parseImageMemoRead({ ...raw, rows: [raw.rows[0], { name: "別の行", days: [{ day: 16, names: ["外部"] }] }] }, raw.period);
    expect(() => mergeImageMemoRead(board, read, ["lane:lane-1", "lane:lane-1"], courses, drivers)).toThrow("重複");
    expect(board.assignments["lane-1|2026-09-16"][0].name).toBe("旧");
  });
});
