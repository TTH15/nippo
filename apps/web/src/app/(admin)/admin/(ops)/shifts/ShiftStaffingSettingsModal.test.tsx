import { describe, expect, it } from "vitest";
import { baselinesToCells, changedBaselines, staffingFrames } from "./ShiftStaffingSettingsModal";

describe("staffingFrames", () => {
  it("便を使うコースは便ごと、使わないコースは0の1枠", () => {
    const frames = staffingFrames([
      { id: "c1", name: "豊中", uses_cycles: true, course_cycles: [{ cycle_no: 1, label: "C1" }, { cycle_no: 2, label: null }] },
      { id: "c2", name: "吹田", uses_cycles: false, course_cycles: [] },
    ]);
    expect(frames.map((f) => [f.courseId, f.cycleNo, f.label])).toEqual([
      ["c1", 1, "豊中 C1"],
      ["c1", 2, "豊中 2便"],
      ["c2", 0, "吹田"],
    ]);
  });

  it("アーカイブ済みコースと停止中の便は出さない", () => {
    const frames = staffingFrames([
      { id: "c1", name: "旧コース", archived_at: "2026-01-01", uses_cycles: false },
      { id: "c2", name: "豊中", uses_cycles: true, course_cycles: [{ cycle_no: 1, label: "C1", active: false }, { cycle_no: 2, label: "C2" }] },
    ]);
    expect(frames.map((f) => f.cycleNo)).toEqual([2]);
  });
});

describe("baselinesToCells", () => {
  it("休みと人数を区別して読む", () => {
    const cells = baselinesToCells([
      { course_id: "c1", cycle_no: 1, weekday: 1, state: "working", required_count: 2 },
      { course_id: "c1", cycle_no: 1, weekday: 0, state: "closed", required_count: null },
    ]);
    expect(cells["c1|1|1"]).toBe(2);
    expect(cells["c1|1|0"]).toBe("closed");
    expect(cells["c1|1|2"]).toBeUndefined();
  });
});

describe("changedBaselines", () => {
  const saved = { "c1|1|1": 2, "c1|1|0": "closed" as const };

  it("変えていないセルは送らない", () => {
    expect(changedBaselines({ ...saved }, saved)).toEqual([]);
  });

  it("人数の変更は working で送る", () => {
    const changes = changedBaselines({ ...saved, "c1|1|1": 3 }, saved);
    expect(changes).toEqual([{ courseId: "c1", cycleNo: 1, weekday: 1, state: "working", requiredCount: 3 }]);
  });

  it("0人も変更として送る（未設定と混ぜない）", () => {
    const changes = changedBaselines({ ...saved, "c1|1|1": 0 }, saved);
    expect(changes[0]).toMatchObject({ state: "working", requiredCount: 0 });
  });

  it("未設定へ戻すと state:null で消す", () => {
    const changes = changedBaselines({ ...saved, "c1|1|0": undefined }, saved);
    expect(changes).toEqual([{ courseId: "c1", cycleNo: 1, weekday: 0, state: null, requiredCount: null }]);
  });

  it("休みへ変えると人数を持たない", () => {
    const changes = changedBaselines({ ...saved, "c1|1|1": "closed" }, saved);
    expect(changes[0]).toMatchObject({ state: "closed", requiredCount: null });
  });
});
