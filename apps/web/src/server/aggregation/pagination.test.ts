import { describe, it, expect } from "vitest";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "./pagination";

// PostgREST の db-max-rows（1000件）サイレント切り詰め対策の中核ヘルパー。
// 「1000行を超えてから静かに壊れる」系の回帰を CI で塞ぐ。

function makeRows(n: number): { id: number }[] {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

describe("fetchAllRows", () => {
  it("1000行超を複数ページで全件取得する（切り詰めなし・重複なし）", async () => {
    const all = makeRows(2350);
    const calls: [number, number][] = [];
    const rows = await fetchAllRows<{ id: number }>((from, to) => {
      calls.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    });
    expect(rows).toHaveLength(2350);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2350);
    // 1000件ずつ 3 ページ（最後のページが 1000 未満で停止）
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("ちょうどページ境界（1000件）でも余分な空ページ1回で正しく停止する", async () => {
    const all = makeRows(1000);
    const rows = await fetchAllRows<{ id: number }>((from, to) =>
      Promise.resolve({ data: all.slice(from, to + 1), error: null }),
    );
    expect(rows).toHaveLength(1000);
  });

  it("エラーは握りつぶさず throw する", async () => {
    await expect(
      fetchAllRows(() => Promise.resolve({ data: null, error: new Error("boom") })),
    ).rejects.toThrow("boom");
  });

  it("IN_CLAUSE_BATCH_SIZE は URL ヘッダ上限の安全圏（200以下）", () => {
    expect(IN_CLAUSE_BATCH_SIZE).toBeLessThanOrEqual(200);
  });
});
