import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingOrgColumn } from "@/server/db/orgColumn";

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
  orgId: string,
  reportId: string,
  next: ReportEntryUpsertRow[],
): Promise<void> {
  const { data: existing, error: readErr } = await supabase
    // tenant-scope-ok: reportId は呼び出し元が .eq("org_id", orgId) で読んだ日報の id
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

  const withOrg = upserts.map((e) => ({ org_id: orgId, ...e }));
  const [delRes, upRes] = await Promise.all([
    deleteIds.length
      // tenant-scope-ok: deleteIds は直上の reportId 限定 select（existing）由来
      ? supabase.from("report_entries").delete().in("id", deleteIds)
      : Promise.resolve({ error: null }),
    upserts.length
      ? supabase
          // tenant-scope-ok: 各行に org_id: orgId（呼び出し元が確認済みの org）を入れている
          .from("report_entries")
          .upsert(withOrg, { onConflict: "report_id,unit_id,field_key" })
      : Promise.resolve({ error: null }),
  ]);
  if (delRes.error) throw delRes.error;
  if (!upRes.error) return;
  if (!isMissingOrgColumn(upRes.error)) throw upRes.error;
  // migration 177 未適用の環境向けフォールバック（org_id 列がまだ無い）
  const { error: retryErr } = await supabase
    // tenant-scope-ok: 同じ行の退避。migration 177 未適用（org_id 列が無い）環境でのみ通る
    .from("report_entries")
    .upsert(upserts, { onConflict: "report_id,unit_id,field_key" });
  if (retryErr) throw retryErr;
}
