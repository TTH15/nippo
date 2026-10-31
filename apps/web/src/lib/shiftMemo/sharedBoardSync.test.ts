import { describe, expect, it } from "vitest";
import { applyBoardChanges, boardChanges, mergeBoardChanges, SharedBoardSession } from "./sharedBoardSync";

const base = { version: 1, lanes: [], laneOrder: [], hiddenLaneIds: [], routeOrder: [], hiddenRouteIds: [], extraPeople: [], widths: { day: 76 }, assignments: {}, notes: {}, dayOverrides: {}, requiredCountOverrides: {} };

describe("shared board changes", () => {
  it("keeps simultaneous edits to different cells", () => {
    const local = { ...base, assignments: { "lane-a|2026-09-26": [{ name: "A" }] } };
    const remote = { ...base, assignments: { "lane-b|2026-09-26": [{ name: "B" }] } };
    const result = mergeBoardChanges(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.board.assignments).toEqual({ ...local.assignments, ...remote.assignments });
  });

  it("reports edits to the same cell and preserves the local intent", () => {
    const previous = { ...base, notes: { "2026-09-26": "before" } };
    const local = { ...previous, notes: { "2026-09-26": "local" } };
    const remote = { ...previous, notes: { "2026-09-26": "remote" } };
    const result = mergeBoardChanges(previous, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.board.notes).toEqual(local.notes);
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

  it("同値の更新と削除は収束済みとして扱う", () => {
    const previous = { ...base, notes: { a: "前" }, assignments: { x: ["A"] } };
    const local = { ...base, notes: { a: "同じ" }, assignments: {} };
    expect(mergeBoardChanges(previous, local, local).conflicts).toEqual([]);
  });

  it("GET r3の後にPATCH r2が到着しても正本を戻さず追加編集を保持する", () => {
    const session = new SharedBoardSession(base);
    session.accept(base, 1);
    session.edit({ ...base, notes: { a: "送信" } });
    const flight = session.startSave()!;
    session.edit({ ...base, notes: { a: "追加" } });
    session.accept({ ...base, notes: { a: "送信", b: "別セル" } }, 3);
    session.accept({ ...base, notes: { a: "送信" } }, 2, flight.snapshot);
    session.flight = null;
    expect(session.revision).toBe(3);
    expect(session.local.notes).toEqual({ a: "追加", b: "別セル" });
    expect(session.changes).toEqual([{ field: "notes", key: "a", expected: "送信", value: "追加" }]);
    expect(session.accept(base, 1)).toBe(false);
  });

  it("新しいGETで送信値がさらに変更されても古いPATCH確定でローカルを戻さない", () => {
    const session = new SharedBoardSession(base);
    session.accept(base, 1);
    session.edit({ ...base, notes: { a: "送信" } });
    const flight = session.startSave()!;
    session.accept({ ...base, notes: { a: "その後の共有変更" } }, 3);
    expect(session.conflicts).toHaveLength(1);
    session.accept({ ...base, notes: { a: "送信" } }, 2, flight.snapshot);
    session.flight = null;
    expect(session.local.notes).toEqual({ a: "その後の共有変更" });
    expect(session.pending).toBe(false);
  });

  it("通信エラー後に正本で全変更を照合できればpendingを解消する", () => {
    const session = new SharedBoardSession(base);
    session.accept(base, 1);
    session.edit({ ...base, notes: { a: "保存済み" } });
    session.startSave(); session.uncertain = true;
    session.accept({ ...base, notes: { a: "保存済み", b: "別担当" } }, 2);
    session.flight = null; session.uncertain = false;
    expect(session.pending).toBe(false);
    expect(session.local.notes).toEqual({ a: "保存済み", b: "別担当" });
  });

  it("移動先が競合した人員移動を一部だけ送らず、再取得でも解決まで保持する", () => {
    const previous = { ...base, assignments: { source: ["A"], target: [] } };
    const session = new SharedBoardSession(previous);
    session.accept(previous, 1);
    session.edit({ ...previous, assignments: { source: [], target: ["A"] } });
    session.accept({ ...previous, assignments: { source: ["A"], target: ["B"] } }, 2);
    expect(session.local.assignments).toEqual({ source: [], target: ["A"] });
    expect(session.startSave()).toBeNull();
    session.accept(session.canonical, 2);
    expect(session.conflicts).toHaveLength(1);
    expect(session.startSave()).toBeNull();
    session.resolve(true);
    expect(session.startSave()?.changes).toHaveLength(2);
    session.flight = null;
    session.resolve(false);
    expect(session.local).toEqual(session.canonical);
    expect(session.pending).toBe(false);
  });
});

it("曜日と日付の色は独立して同期し、同じ色指定だけを競合として残す", () => {
  const initial={...base,backgroundColors:{"weekday:1":"yellow"}};
  const local={...initial,backgroundColors:{...initial.backgroundColors,"date:2026-10-25":"rose"}};
  const remote={...initial,backgroundColors:{...initial.backgroundColors,"weekday:5":"sky"}};
  const result=mergeBoardChanges(initial,local,remote);
  expect(result.conflicts).toEqual([]);
  expect(result.board.backgroundColors).toEqual({...local.backgroundColors,"weekday:5":"sky"});
  expect(mergeBoardChanges(initial,local,{...initial,backgroundColors:{"date:2026-10-25":"green"}}).conflicts).toHaveLength(1);
});
