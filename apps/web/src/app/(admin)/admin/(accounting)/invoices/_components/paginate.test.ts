import { describe, it, expect } from "vitest";
import { computePageBreaks, computeBreakUnitIds, computePageIndices, type PageUnit } from "./paginate";

let seq = 0;
const unit = (top: number, height: number, forceBreak = false, id?: string, keepWithNext = false): PageUnit => ({
  id: id ?? `u${seq++}`,
  top,
  height,
  forceBreak,
  keepWithNext,
});

describe("computePageBreaks", () => {
  it("すべて1ページに収まる場合は先頭のみ", () => {
    const units = [unit(0, 20), unit(20, 20), unit(40, 20)];
    expect(computePageBreaks(units, 100)).toEqual([0]);
  });

  it("自然な溢れで次のユニットの手前を改ページ", () => {
    const units = [unit(0, 60), unit(60, 60)];
    // pageHeight=100: 2つ目(top=60)を置くと pageStart=0 からの高さが 120 になり溢れる→ top=60 で改ページ
    expect(computePageBreaks(units, 100)).toEqual([0, 60]);
  });

  it("強制改行（forceBreak）は残り高さに余裕があっても必ず改ページ", () => {
    const units = [unit(0, 10), unit(10, 10, true), unit(20, 10)];
    expect(computePageBreaks(units, 1000)).toEqual([0, 10]);
  });

  it("直前の改ページで既にページ先頭に来たユニットには forceBreak があっても冗長な改ページを入れない", () => {
    const units = [unit(0, 50), unit(50, 0, true), unit(50, 20, true)];
    // 2つ目(top=50)の forceBreak で改ページ→ pageStart=50。3つ目も top=50 で既にページ先頭なので何もしない
    expect(computePageBreaks(units, 100)).toEqual([0, 50]);
  });

  it("1ユニットがページ高さを超える場合はそのユニットの直前で改ページする（内部分割はしない）", () => {
    const units = [unit(0, 10), unit(10, 200), unit(210, 10)];
    // 巨大ユニット(10-210)は分割できないため1ページにはみ出して配置される。
    // 直後のユニットは pageStart(=10) から見てまだ溢れているため、そこでも改ページする。
    expect(computePageBreaks(units, 100)).toEqual([0, 10, 210]);
  });

  it("複数回の自然な溢れで複数ページに分割", () => {
    const units = [unit(0, 90), unit(90, 90), unit(180, 90), unit(270, 90)];
    expect(computePageBreaks(units, 100)).toEqual([0, 90, 180, 270]);
  });

  it("空配列は先頭ページのみ", () => {
    expect(computePageBreaks([], 100)).toEqual([0]);
  });

  it("keepWithNext が無い場合、直後のユニット単独だけが次ページへ送られる（振込先だけ浮くバグの再現）", () => {
    const units = [unit(0, 70), unit(70, 20), unit(90, 20)];
    // 3つ目(top=90, height=20)を置くと 90+20=110 > 100 で溢れる→3つ目の手前で改ページ。
    // 2つ目（テーブル）はページ1に残ったまま、3つ目（振込先）だけが単独でページ2へ。
    expect(computePageBreaks(units, 100)).toEqual([0, 90]);
  });

  it("keepWithNext を付けると、テーブルの最終セグメントと振込先ブロックが道連れで次ページへ送られる", () => {
    const units = [unit(0, 70), unit(70, 20, false, undefined, true), unit(90, 20)];
    // 2つ目に keepWithNext を付けると、2つ目+3つ目のグループ合計(70〜110)で溢れ判定。
    // グループごと次ページへ送られるため、テーブルと振込先が同じページに揃う。
    expect(computePageBreaks(units, 100)).toEqual([0, 70]);
  });
});

describe("computeBreakUnitIds", () => {
  it("すべて1ページに収まる場合は空集合", () => {
    const units = [unit(0, 20, false, "a"), unit(20, 20, false, "b")];
    expect(computeBreakUnitIds(units, 100)).toEqual(new Set());
  });

  it("自然な溢れの直前ユニットの id を返す", () => {
    const units = [unit(0, 60, false, "a"), unit(60, 60, false, "b")];
    expect(computeBreakUnitIds(units, 100)).toEqual(new Set(["b"]));
  });

  it("強制改行の直前ユニットの id を返す", () => {
    const units = [unit(0, 10, false, "a"), unit(10, 10, true, "b"), unit(20, 10, false, "c")];
    expect(computeBreakUnitIds(units, 1000)).toEqual(new Set(["b"]));
  });

  it("複数回の改ページで複数 id を返す", () => {
    const units = [unit(0, 90, false, "a"), unit(90, 90, false, "b"), unit(180, 90, false, "c"), unit(270, 90, false, "d")];
    expect(computeBreakUnitIds(units, 100)).toEqual(new Set(["b", "c", "d"]));
  });

  it("ページ先頭ちょうどのユニットには forceBreak があっても id を追加しない", () => {
    const units = [unit(0, 50, false, "a"), unit(50, 0, true, "b"), unit(50, 20, true, "c")];
    expect(computeBreakUnitIds(units, 100)).toEqual(new Set(["b"]));
  });
});

describe("computePageIndices", () => {
  it("すべて1ページに収まる場合は全ユニットが 0", () => {
    const units = [unit(0, 20, false, "a"), unit(20, 20, false, "b")];
    expect(computePageIndices(units, 100)).toEqual(
      new Map([
        ["a", 0],
        ["b", 0],
      ]),
    );
  });

  it("改ページごとにページ番号が1つずつ増える", () => {
    const units = [unit(0, 90, false, "a"), unit(90, 90, false, "b"), unit(180, 90, false, "c"), unit(270, 90, false, "d")];
    expect(computePageIndices(units, 100)).toEqual(
      new Map([
        ["a", 0],
        ["b", 1],
        ["c", 2],
        ["d", 3],
      ]),
    );
  });

  it("強制改行でもページ番号が増える", () => {
    const units = [unit(0, 10, false, "a"), unit(10, 10, true, "b"), unit(20, 10, false, "c")];
    expect(computePageIndices(units, 1000)).toEqual(
      new Map([
        ["a", 0],
        ["b", 1],
        ["c", 1],
      ]),
    );
  });
});
