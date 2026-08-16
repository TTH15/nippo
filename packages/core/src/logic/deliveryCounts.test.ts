import { describe, it, expect } from "vitest";
import {
  accumulate,
  classifyCountField,
  EMPTY_TOTALS,
  perDriver,
  returnRate,
} from "./deliveryCounts";

// 役割の推定を間違えると、持戻を完了に足して「配達できた数」が水増しされる。
// 実データの項目名（completed / returned / mochidashi・完了個数 / 持戻個数）を固定する。

describe("classifyCountField", () => {
  it("完了系を completed と判定する", () => {
    expect(classifyCountField({ key: "completed", label: "完了個数" })).toBe("completed");
    expect(classifyCountField({ key: "am_completed", label: "午前 完了個数" })).toBe("completed");
    expect(classifyCountField({ key: "x", label: "完了数" })).toBe("completed");
  });

  it("持戻系を returned と判定する", () => {
    expect(classifyCountField({ key: "returned", label: "持戻個数" })).toBe("returned");
    expect(classifyCountField({ key: "x", label: "持ち戻り" })).toBe("returned");
  });

  it("「持戻個数」を完了と取り違えない（判定順の担保）", () => {
    // "持戻個数" は "個数" を含むうえ、キーに completed を含む命名もありうる
    expect(classifyCountField({ key: "completed_returned", label: "持戻個数" })).toBe("returned");
  });

  it("持出など分類できないものは other（合計や率から外す）", () => {
    expect(classifyCountField({ key: "mochidashi", label: "持出個数" })).toBe("other");
    expect(classifyCountField({ key: "memo", label: "備考" })).toBe("other");
  });

  it("ラベルが無くてもキーだけで判定できる", () => {
    expect(classifyCountField({ key: "completed" })).toBe("completed");
    expect(classifyCountField({ key: "returned", label: null })).toBe("returned");
  });
});

describe("accumulate", () => {
  it("役割ごとに足し込む（元の値は書き換えない）", () => {
    const a = accumulate(EMPTY_TOTALS, "completed", 10);
    const b = accumulate(a, "returned", 2);
    expect(b).toEqual({ completed: 10, returned: 2, other: 0 });
    expect(EMPTY_TOTALS).toEqual({ completed: 0, returned: 0, other: 0 });
  });
});

describe("returnRate", () => {
  it("完了＋持戻 に対する持戻の割合", () => {
    expect(returnRate({ completed: 98, returned: 2 })).toBeCloseTo(2);
  });

  it("母数が0なら null（0% と出して実績があるように見せない）", () => {
    expect(returnRate({ completed: 0, returned: 0 })).toBeNull();
  });

  it("全部持戻なら100%", () => {
    expect(returnRate({ completed: 0, returned: 5 })).toBe(100);
  });
});

describe("perDriver", () => {
  it("1人あたりの個数", () => {
    expect(perDriver(1000, 4)).toBe(250);
  });

  it("人数0なら null", () => {
    expect(perDriver(1000, 0)).toBeNull();
  });
});
