import { describe, expect, it } from "vitest";
import { applyBoardChanges, boardChanges, mergeBoardChanges } from "./sharedBoardSync";

const base = { version: 1, lanes: [], laneOrder: [], hiddenLaneIds: [], routeOrder: [], hiddenRouteIds: [], extraPeople: [], widths: { day: 76 }, assignments: {}, notes: {}, dayOverrides: {}, requiredCountOverrides: {} };

describe("shared board changes", () => {
  it("keeps simultaneous edits to different cells", () => {
    const local = { ...base, assignments: { "lane-a|2026-09-26": [{ name: "A" }] } };
    const remote = { ...base, assignments: { "lane-b|2026-09-26": [{ name: "B" }] } };
    const result = mergeBoardChanges(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.board.assignments).toEqual({ ...local.assignments, ...remote.assignments });
  });

  it("reports edits to the same cell and preserves the saved value", () => {
    const previous = { ...base, notes: { "2026-09-26": "before" } };
    const local = { ...previous, notes: { "2026-09-26": "local" } };
    const remote = { ...previous, notes: { "2026-09-26": "remote" } };
    const result = mergeBoardChanges(previous, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.board.notes).toEqual(remote.notes);
  });

  it("sends deletions for removed cell values", () => {
    const previous = { ...base, requiredCountOverrides: { "lane-a|2026-09-26": 3 } };
    const changes = boardChanges(previous, { ...base });
    expect(changes).toEqual([{ field: "requiredCountOverrides", key: "lane-a|2026-09-26", expected: 3, value: null }]);
    expect(applyBoardChanges(previous, changes)).toEqual(base);
  });

  it("does not save merely because JSON object keys changed order", () => {
    const fromDb = { ...base, widths: { detail: 330, lane: 190, day: 76 }, assignments: { x: [{ name: "A", personKey: "1" }] } };
    const fromUi = { ...base, widths: { day: 76, lane: 190, detail: 330 }, assignments: { x: [{ personKey: "1", name: "A" }] } };
    expect(boardChanges(fromDb, fromUi)).toEqual([]);
  });

  it("treats omitted optional fields like JSON serialization", () => {
    const local = { ...base, assignments: { x: [{ name: "応援", driverId: undefined }] } };
    const fromDb = { ...base, assignments: { x: [{ name: "応援" }] } };
    expect(boardChanges(fromDb, local)).toEqual([]);
  });
});
