import { describe, expect, it } from "vitest";
import {
  cellEdges, describeSelection, extendDays, extendRows, extendToCell, includedIndexes,
  isCellIncluded, isDayIncluded, isRowIncluded, isSelectAll, isSelectionEmpty,
  selectAll, selectCellRect, selectDays, selectRows, toggleDay, toggleRow,
} from "./selection";

const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const D = dates.length;
const R = 4;
const inc = (s: Parameters<typeof includedIndexes>[0]) => includedIndexes(s, D, R);

describe("セルのドラッグ", () => {
  it("どちら向きに引いても同じ範囲になる", () => {
    const a = selectCellRect({ dayIndex: 3, rowIndex: 2 }, { dayIndex: 1, rowIndex: 0 }, D, R);
    const b = selectCellRect({ dayIndex: 1, rowIndex: 0 }, { dayIndex: 3, rowIndex: 2 }, D, R);
    expect(inc(a)).toEqual(inc(b));
    expect(inc(a)).toEqual({ days: [1, 2, 3], rows: [0, 1, 2] });
  });

  it("1セルだけでも選べる", () => {
    const s = selectCellRect({ dayIndex: 2, rowIndex: 1 }, { dayIndex: 2, rowIndex: 1 }, D, R);
    expect(inc(s)).toEqual({ days: [2], rows: [1] });
  });

  it("表全体を選んだら「全部」に畳む", () => {
    const s = selectCellRect({ dayIndex: 0, rowIndex: 0 }, { dayIndex: D - 1, rowIndex: R - 1 }, D, R);
    expect(isSelectAll(s)).toBe(true);
  });
});

describe("Shift+クリックで伸ばす", () => {
  it("起点から今のセルまで矩形になる", () => {
    const first = selectCellRect({ dayIndex: 1, rowIndex: 1 }, { dayIndex: 1, rowIndex: 1 }, D, R);
    const extended = extendToCell(first, { dayIndex: 3, rowIndex: 2 }, D, R);
    expect(inc(extended)).toEqual({ days: [1, 2, 3], rows: [1, 2] });
  });

  it("起点より手前へも伸ばせる", () => {
    const first = selectCellRect({ dayIndex: 3, rowIndex: 2 }, { dayIndex: 3, rowIndex: 2 }, D, R);
    const extended = extendToCell(first, { dayIndex: 1, rowIndex: 0 }, D, R);
    expect(inc(extended)).toEqual({ days: [1, 2, 3], rows: [0, 1, 2] });
  });

  it("起点が無ければ単独クリックと同じ", () => {
    expect(inc(extendToCell(selectAll, { dayIndex: 2, rowIndex: 1 }, D, R))).toEqual({ days: [2], rows: [1] });
  });
});

describe("名前クリック＝行全体", () => {
  it("その行だけ・日付は全部になる", () => {
    const s = selectRows([1], D, R, 1);
    expect(inc(s)).toEqual({ days: [0, 1, 2, 3, 4], rows: [1] });
  });

  it("Shift+クリックで起点の行から今の行まで", () => {
    const s = extendRows(selectRows([1], D, R, 1), 3, D, R);
    expect(inc(s).rows).toEqual([1, 2, 3]);
  });

  it("Cmd+クリックで飛び飛びに足せる", () => {
    const s = toggleRow(toggleRow(selectRows([0], D, R, 0), 2, R), 3, R);
    expect(inc(s).rows).toEqual([0, 2, 3]);
  });

  it("Cmd+クリックで外せる", () => {
    const s = toggleRow(selectAll, 1, R);
    expect(inc(s).rows).toEqual([0, 2, 3]);
  });

  it("最後の1行は外せない（空の出力を作らない）", () => {
    const one = selectRows([2], D, R, 2);
    expect(inc(toggleRow(one, 2, R)).rows).toEqual([2]);
  });
});

describe("日付の見出しクリック＝列全体", () => {
  it("その列だけ・人は全部になる", () => {
    expect(inc(selectDays([2], D, R, 2))).toEqual({ days: [2], rows: [0, 1, 2, 3] });
  });

  it("Shift+クリックで起点の列から今の列まで", () => {
    expect(inc(extendDays(selectDays([1], D, R, 1), 3, D)).days).toEqual([1, 2, 3]);
  });

  it("Cmd+クリックで飛び飛びに足せる・外せる", () => {
    expect(inc(toggleDay(selectDays([0], D, R, 0), 4, D)).days).toEqual([0, 4]);
    expect(inc(toggleDay(selectAll, 2, D)).days).toEqual([0, 1, 3, 4]);
  });

  it("最後の1列は外せない", () => {
    const one = selectDays([1], D, R, 1);
    expect(inc(toggleDay(one, 1, D)).days).toEqual([1]);
  });
});

describe("セルが出力に入るか", () => {
  it("列と行の両方が選ばれているときだけ入る", () => {
    const s = selectCellRect({ dayIndex: 1, rowIndex: 1 }, { dayIndex: 2, rowIndex: 2 }, D, R);
    expect(isCellIncluded(s, 1, 1)).toBe(true);
    expect(isCellIncluded(s, 1, 3)).toBe(false);
    expect(isDayIncluded(s, 1)).toBe(true);
    expect(isRowIncluded(s, 3)).toBe(false);
  });

  it("未選択なら全部入る", () => {
    expect(isCellIncluded(selectAll, 0, 0)).toBe(true);
    expect(isSelectionEmpty(selectAll, D, R)).toBe(false);
  });
});

describe("選択枠は隣が選ばれていない辺だけに引く", () => {
  it("矩形の四隅では2辺に線が入る", () => {
    const s = selectCellRect({ dayIndex: 1, rowIndex: 1 }, { dayIndex: 3, rowIndex: 2 }, D, R);
    expect(cellEdges(s, 1, 1, D, R)).toEqual({ top: true, bottom: false, left: true, right: false });
    expect(cellEdges(s, 3, 2, D, R)).toEqual({ top: false, bottom: true, left: false, right: true });
  });

  it("中の辺には線を引かない", () => {
    const s = selectCellRect({ dayIndex: 1, rowIndex: 1 }, { dayIndex: 3, rowIndex: 2 }, D, R);
    expect(cellEdges(s, 2, 1, D, R)).toEqual({ top: true, bottom: false, left: false, right: false });
  });

  it("選ばれていないセルには枠を出さない", () => {
    const s = selectCellRect({ dayIndex: 1, rowIndex: 1 }, { dayIndex: 2, rowIndex: 1 }, D, R);
    expect(cellEdges(s, 0, 0, D, R)).toBeNull();
  });

  it("全選択でも表の縁には枠を出す", () => {
    expect(cellEdges(selectAll, 0, 0, D, R)).toEqual({ top: true, bottom: false, left: true, right: false });
    expect(cellEdges(selectAll, D - 1, R - 1, D, R)).toEqual({ top: false, bottom: true, left: false, right: true });
  });

  it("飛び飛びの行はそれぞれ枠で囲む", () => {
    const s = toggleRow(selectRows([0], D, R, 0), 2, R);
    expect(cellEdges(s, 0, 0, D, R)).toEqual({ top: true, bottom: true, left: true, right: false });
    expect(cellEdges(s, 0, 2, D, R)).toEqual({ top: true, bottom: true, left: true, right: false });
  });
});

describe("選択の要約", () => {
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");

  it("連続した期間は範囲で伝える", () => {
    const s = selectCellRect({ dayIndex: 1, rowIndex: 0 }, { dayIndex: 3, rowIndex: 1 }, D, R);
    expect(describeSelection(s, dates, fmt, R)).toBe("09/02〜09/04（3日） · 2人");
  });

  it("1日だけなら範囲にしない", () => {
    expect(describeSelection(selectDays([2], D, R, 2), dates, fmt, R)).toBe("09/03（1日） · 4人");
  });

  it("飛び飛びなら「ほか」で伝える", () => {
    const s = toggleDay(selectDays([0], D, R, 0), 4, D);
    expect(describeSelection(s, dates, fmt, R)).toBe("09/01 ほか（2日） · 4人");
  });
});
