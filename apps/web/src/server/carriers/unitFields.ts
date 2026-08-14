import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

/**
 * 指定 unit 群の unit_fields を全件取得する（sort_order 順）。
 * unit_fields は org 列を持たない子テーブルのため、org で絞った units の id を渡すこと。
 * 素SELECT 全件だと他社の項目まで転送し、かつ PostgREST の1000行サイレント切り詰めで
 * 自社の項目が静かに消える（キャリア/送信後画面/イベントの3画面が同型だった・2026-08-14）。
 */
export async function loadUnitFieldsForUnits(
  supabase: SupabaseClient,
  unitIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  if (unitIds.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  for (let i = 0; i < unitIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const slice = unitIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from("unit_fields")
        .select("*")
        .in("unit_id", slice)
        // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
        .order("id", { ascending: true })
        .range(from, to),
    );
    out.push(...rows);
  }
  out.sort((a, b) => (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0));
  return out;
}
