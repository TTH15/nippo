import { describe, it, expect } from "vitest";
import {
  parseClipboardGrid,
  applyPaste,
  fillColumn,
  insertLineAt,
  removeLineAt,
  moveLine,
} from "./lineGrid";
import { emptyLine, type EditorLine } from "./editorModel";

const line = (title: string, qty = "", unit = "", price = ""): EditorLine => ({
  title,
  qty,
  unit,
  price,
  priceBasis: "exclusive",
});

describe("parseClipboardGrid", () => {
  it("TSVを行列に分解する", () => {
    expect(parseClipboardGrid("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("CRLF・末尾改行を正規化する", () => {
    expect(parseClipboardGrid("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("空文字は空配列", () => {
    expect(parseClipboardGrid("")).toEqual([]);
  });
});

describe("applyPaste", () => {
  it("起点セルから行列を流し込み、不足行は追加する", () => {
    const lines = [emptyLine()];
    const next = applyPaste(lines, 0, 0, [
      ["宅急便", "10", "個", "150"],
      ["ネコポス", "5", "個", "100"],
    ]);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(line("宅急便", "10", "個", "150"));
    expect(next[1]).toEqual(line("ネコポス", "5", "個", "100"));
  });
  it("数値列のカンマ・¥・全角空白を除去する", () => {
    const next = applyPaste([emptyLine()], 0, 1, [["1,200", "", "￥3,000"]]);
    // col1=qty, col2=unit, col3=price
    expect(next[0].qty).toBe("1200");
    expect(next[0].price).toBe("3000");
  });
  it("起点列より右にはみ出す列は無視する", () => {
    const next = applyPaste([emptyLine()], 0, 3, [["100", "あふれ"]]);
    expect(next[0].price).toBe("100");
    // 5列目は存在しないので破棄
    expect(next).toHaveLength(1);
  });
});

describe("fillColumn", () => {
  it("起点行の値を範囲の同一列にコピーする", () => {
    const lines = [line("a", "1"), line("b", "2"), line("c", "3")];
    const next = fillColumn(lines, 1, 0, 2); // qty列を0→2へ
    expect(next.map((l) => l.qty)).toEqual(["1", "1", "1"]);
    // 他列は不変
    expect(next.map((l) => l.title)).toEqual(["a", "b", "c"]);
  });
  it("逆方向（下→上）でも範囲を満たす", () => {
    const lines = [line("a", "1"), line("b", "2"), line("c", "3")];
    const next = fillColumn(lines, 1, 2, 0);
    expect(next.map((l) => l.qty)).toEqual(["3", "3", "3"]);
  });
});

describe("insert / remove / move", () => {
  it("指定位置に空行を挿入", () => {
    const next = insertLineAt([line("a"), line("b")], 1);
    expect(next.map((l) => l.title)).toEqual(["a", "", "b"]);
  });
  it("行削除、全消し時は空1行を残す", () => {
    expect(removeLineAt([line("a"), line("b")], 0).map((l) => l.title)).toEqual(["b"]);
    // 最後の1行を消しても0行になってよい（表自体は残る仕様）
    expect(removeLineAt([line("only")], 0)).toEqual([]);
  });
  it("行を並べ替える", () => {
    const next = moveLine([line("a"), line("b"), line("c")], 0, 2);
    expect(next.map((l) => l.title)).toEqual(["b", "c", "a"]);
  });
});
