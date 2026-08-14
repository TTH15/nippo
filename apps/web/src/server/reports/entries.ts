import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// report_entries（縦持ち）の差分同期。
// 従来の「全削除→全挿入」は変更のない項目まで毎回書き直し、行IDと created_at が
// 総入れ替えになっていた（2026-08 監査）。UNIQUE(report_id, unit_id, field_key) を
// 使い、変わった項目だけ upsert・消えた項目だけ delete する。
// ============================================================

export type ReportEntryUpsertRow = {
  report_id: string;
  unit_id: string;
  field_key: string;
  value_num: number | null;
  value_text: string | null;
};

const keyOf = (e: { unit_id: string; field_key: string }) => `${e.unit_id}:${e.field_key}`;
const numOf = (v: unknown): number | null => (v == null ? null : Number(v));

/** 指定日報の entries を next の内容へ差分同期する。エラーは throw。 */
export async function syncReportEntries(
  supabase: SupabaseClient,
  reportId: string,
  next: ReportEntryUpsertRow[],
): Promise<void> {
  const { data: existing, error: readErr } = await supabase
    .from("report_entries")
    .select("id, unit_id, field_key, value_num, value_text")
    .eq("report_id", reportId);
  if (readErr) throw readErr;

  const nextByKey = new Map(next.map((e) => [keyOf(e), e]));
  const deleteIds: string[] = [];
  const unchanged = new Set<string>();
  for (const row of existing ?? []) {
    const key = keyOf(row as { unit_id: string; field_key: string });
    const n = nextByKey.get(key);
    if (!n) {
      deleteIds.push((row as { id: string }).id);
      continue;
    }
    // numeric は PostgREST 経由で文字列になることがあるため数値化して比較する
    const sameNum = numOf((row as { value_num: unknown }).value_num) === (n.value_num ?? null);
    const sameText = ((row as { value_text: string | null }).value_text ?? null) === (n.value_text ?? null);
    if (sameNum && sameText) unchanged.add(key);
  }
  const upserts = next.filter((e) => !unchanged.has(keyOf(e)));

  const [delRes, upRes] = await Promise.all([
    deleteIds.length
      ? supabase.from("report_entries").delete().in("id", deleteIds)
      : Promise.resolve({ error: null }),
    upserts.length
      ? supabase
          .from("report_entries")
          .upsert(upserts, { onConflict: "report_id,unit_id,field_key" })
      : Promise.resolve({ error: null }),
  ]);
  if (delRes.error) throw delRes.error;
  if (upRes.error) throw upRes.error;
}
