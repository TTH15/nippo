import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// コース（＋便）ごとに使う日報項目の絞り込み。
// 報告項目はキャリア配下の unit に付くが、実際に使う項目はコースで違う
// （Amazon配送は午前/午後/4便の6項目だが、上鳥羽のC1は午前だけ使う）。
// course_report_fields に行があるコース/便はその項目だけを使い、
// 行が無ければ全項目を使う（後方互換）。
// ============================================================

export type CourseReportFieldFilter = {
  /** その (course, cycle, unit, field) を日報で使うか */
  allows: (courseId: string | null, cycleNo: number, unitId: string, fieldKey: string) => boolean;
  /** そのコース/便に絞り込み設定があるか（無ければ全項目） */
  hasFilter: (courseId: string | null, cycleNo: number) => boolean;
};

const key = (courseId: string, cycleNo: number) => `${courseId}:${cycleNo}`;
const fieldKey = (courseId: string, cycleNo: number, unitId: string, field: string) =>
  `${courseId}:${cycleNo}:${unitId}:${field}`;

/**
 * 指定コース群の絞り込み設定を読む。
 * 便別(cycle_no>0)の設定が無い便は、コース共通(cycle_no=0)の設定へフォールバックする。
 */
export async function loadCourseReportFields(
  supabase: SupabaseClient,
  courseIds: string[],
): Promise<CourseReportFieldFilter> {
  const configured = new Set<string>();
  const allowed = new Set<string>();
  if (courseIds.length) {
    const { data } = await supabase
      .from("course_report_fields")
      .select("course_id, cycle_no, unit_id, field_key")
      .in("course_id", courseIds);
    for (const row of data ?? []) {
      const cycleNo = Number(row.cycle_no) || 0;
      configured.add(key(row.course_id, cycleNo));
      allowed.add(fieldKey(row.course_id, cycleNo, row.unit_id, row.field_key));
    }
  }

  /** その便に設定が無ければコース共通(0)を見る。どちらも無ければ絞り込み無し。 */
  const resolveCycle = (courseId: string, cycleNo: number): number | null => {
    if (configured.has(key(courseId, cycleNo))) return cycleNo;
    if (cycleNo !== 0 && configured.has(key(courseId, 0))) return 0;
    return null;
  };

  return {
    hasFilter: (courseId, cycleNo) =>
      courseId != null && resolveCycle(courseId, Number(cycleNo) || 0) != null,
    allows: (courseId, cycleNo, unitId, field) => {
      if (!courseId) return true;
      const resolved = resolveCycle(courseId, Number(cycleNo) || 0);
      if (resolved == null) return true; // 設定が無いコース/便は全項目
      return allowed.has(fieldKey(courseId, resolved, unitId, field));
    },
  };
}

/** 設定が無いときに全許可として振る舞うフィルタ（呼び出し側の分岐を減らす） */
export const allowAllReportFields: CourseReportFieldFilter = {
  allows: () => true,
  hasFilter: () => false,
};
