// Pure field selection; preserves exact cycle/common/no-settings fallback.
export type CourseReportFieldFilter = {
  /** その (course, cycle, unit, field) を日報で使うか */
  allows: (courseId: string | null, cycleNo: number, unitId: string, fieldKey: string) => boolean;
  /** そのコース/便に絞り込み設定があるか（無ければ全項目） */
  hasFilter: (courseId: string | null, cycleNo: number) => boolean;
};

const key = (courseId: string, cycleNo: number) => `${courseId}:${cycleNo}`;
const fieldKey = (courseId: string, cycleNo: number, unitId: string, field: string) =>
  `${courseId}:${cycleNo}:${unitId}:${field}`;

export function createCourseReportFieldFilter(rows: {course_id:string;cycle_no:number;unit_id:string;field_key:string}[]):CourseReportFieldFilter {
  const configured=new Set<string>(),allowed=new Set<string>();
  for(const row of rows){const cycleNo=Number(row.cycle_no)||0;configured.add(key(row.course_id,cycleNo));allowed.add(fieldKey(row.course_id,cycleNo,row.unit_id,row.field_key));}

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

/** 未入力・0・未チェックは便の数量混在として扱わない。 */
export function hasMeaningfulReportValue(valueNum: number | null | undefined, valueText: string | null | undefined): boolean {
  return (valueNum != null && Number(valueNum) !== 0) || !["", "false"].includes((valueText ?? "").trim());
}
