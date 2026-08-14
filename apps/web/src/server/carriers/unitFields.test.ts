import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadUnitFieldsForUnits } from "./unitFields";
import { IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

// unit_fields は org 列を持たない子テーブル。org で絞った units の id を IN 分割+
// 全件ページングで取得する（素SELECT 全件は他社分の転送＋1000行切り詰め）。
// 2026-08-14 監査: carriers / submit-screen / events 詳細の3画面が同型だった。

type Row = { unit_id: string; sort_order: number };

/** from("unit_fields").select().in().order().range() だけを満たす最小スタブ。 */
function makeSupabaseStub(rowsByUnit: Map<string, Row[]>) {
  const inCalls: string[][] = [];
  const client = {
    from: (table: string) => {
      if (table !== "unit_fields") throw new Error(`unexpected table: ${table}`);
      let ids: string[] = [];
      const chain = {
        select: () => chain,
        in: (_col: string, v: string[]) => {
          ids = v;
          inCalls.push(v);
          return chain;
        },
        order: () => chain,
        range: (from: number, to: number) => {
          const all = ids.flatMap((id) => rowsByUnit.get(id) ?? []);
          return Promise.resolve({ data: all.slice(from, to + 1), error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, inCalls };
}

describe("loadUnitFieldsForUnits", () => {
  it("unit ids を IN_CLAUSE_BATCH_SIZE ごとに分割して全件返す", async () => {
    const unitIds = Array.from({ length: IN_CLAUSE_BATCH_SIZE * 2 + 50 }, (_, i) => `u${i}`);
    const rowsByUnit = new Map<string, Row[]>(
      unitIds.map((id, i) => [id, [{ unit_id: id, sort_order: i }]]),
    );
    const { client, inCalls } = makeSupabaseStub(rowsByUnit);

    const rows = await loadUnitFieldsForUnits(client, unitIds);

    expect(rows).toHaveLength(unitIds.length);
    // 分割: 200 + 200 + 50（範囲は毎回同じ ids で range ページングされるため、
    // ページ再試行分を除いた「ユニークなID集合」で検証する）
    const uniqueBatches = Array.from(new Set(inCalls.map((c) => c.join(","))));
    expect(uniqueBatches).toHaveLength(3);
    expect(uniqueBatches[0].split(",")).toHaveLength(IN_CLAUSE_BATCH_SIZE);
    expect(uniqueBatches[2].split(",")).toHaveLength(50);
  });

  it("1バッチ内で1000行を超えてもページングで全件取得する", async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({ unit_id: "u1", sort_order: i }));
    const { client } = makeSupabaseStub(new Map([["u1", rows]]));

    const out = await loadUnitFieldsForUnits(client, ["u1"]);
    expect(out).toHaveLength(1500);
  });

  it("バッチをまたいでも sort_order 順に整列される", async () => {
    const rowsByUnit = new Map<string, Row[]>();
    const unitIds: string[] = [];
    // 後のバッチほど小さい sort_order を持たせる
    for (let i = 0; i < IN_CLAUSE_BATCH_SIZE + 10; i++) {
      const id = `u${i}`;
      unitIds.push(id);
      rowsByUnit.set(id, [{ unit_id: id, sort_order: 1000 - i }]);
    }
    const { client } = makeSupabaseStub(rowsByUnit);

    const out = await loadUnitFieldsForUnits(client, unitIds);
    const orders = out.map((r) => r.sort_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("unit ids が空なら1クエリも撃たず空配列", async () => {
    const { client, inCalls } = makeSupabaseStub(new Map());
    const out = await loadUnitFieldsForUnits(client, []);
    expect(out).toEqual([]);
    expect(inCalls).toHaveLength(0);
  });
});
