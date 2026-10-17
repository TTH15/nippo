import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCourseReportFields } from "./courseReportFields";
import { hasMeaningfulReportValue } from "./courseReportFieldFilter";

type Entry = { unitId: string; fieldKey: string; valueNum?: number | null; valueText?: string | null };
type Item = { courseId: string; cycleNo?: number; entries: Entry[] };
export const FIELD_REVIEW_MESSAGE = "便の設定と異なる項目があります。日報を確認してから入力し直してください。";

/** ヘッダを更新する前に全件を検証。保存済みの設定外実績をフォームから黙って消さない。 */
export async function validateReportFieldWrites(db: SupabaseClient, org: string, items: Item[], reports: { id: string; course_id: string | null; cycle_no: number | null }[], preserveUnchanged = false) {
  if (!items.length) return null;
  const courses = [...new Set(items.map(i => i.courseId))];
  // リクエストのIDで他社設定を読まない。
  const { data: scoped, error: scopeError } = await db.from("courses").select("id").eq("org_id", org).in("id", courses);
  if (scopeError) throw scopeError;
  if (scoped?.length !== courses.length) return FIELD_REVIEW_MESSAGE;
  const filter = await loadCourseReportFields(db, courses);
  const ids = reports.map(r => r.id);
  // tenant-scope-ok: reports は呼出元で org と対象ドライバーを照合した日報集合
  const { data: previous, error } = ids.length
    ? await db
      // tenant-scope-ok: 日報IDは呼出元で会社・本人・対象日を照合済み
      .from("report_entries").select("report_id, unit_id, field_key, value_num, value_text").in("report_id", ids)
    : { data: [], error: null };
  if (error) throw error;
  for (const item of items) {
    const cycle = Number(item.cycleNo) || 0;
    const report = reports.find(r => r.course_id === item.courseId && (Number(r.cycle_no) || 0) === cycle);
    const old = (previous ?? []).filter(e => e.report_id === report?.id);
    if (!preserveUnchanged && old.some(e => hasMeaningfulReportValue(e.value_num, e.value_text) && !filter.allows(item.courseId, cycle, e.unit_id, e.field_key))) return FIELD_REVIEW_MESSAGE;
    for (const e of item.entries ?? []) {
      if (!hasMeaningfulReportValue(e.valueNum, e.valueText) || filter.allows(item.courseId, cycle, e.unitId, e.fieldKey)) continue;
      const existing = old.find(o => o.unit_id === e.unitId && o.field_key === e.fieldKey);
      if (preserveUnchanged && existing && (existing.value_num ?? null) === (e.valueNum ?? null) && (existing.value_text ?? null) === (e.valueText ?? null)) continue;
      return FIELD_REVIEW_MESSAGE;
    }
  }
  return null;
}
