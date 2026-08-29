import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "./pagination";
import { loadCourseReportFields } from "@/server/reports/courseReportFields";

// ============================================================
// 日報の「内容」を送信画面と同じ動的構造(unit → fields → value)で取得するローダー。
//   report_entries(縦持ち) を unit_fields/units と結合し、reportId ごとに
//   sort_order 順のユニット/フィールドへ再構成する。運営一覧の内容表示用。
// ============================================================

export type ReportContentField = {
  fieldKey: string;
  label: string;
  inputType: string; // INT | TEXT | TIME | BOOL
  groupLabel: string | null;
  valueNum: number | null;
  valueText: string | null;
};

export type ReportContentUnit = {
  unitId: string;
  unitName: string;
  fields: ReportContentField[];
};

/** daily_reports_v2.id の配列 → reportId ごとの内容(ユニット配列) */
export async function loadReportContents(
  supabase: SupabaseClient,
  reportIds: string[],
): Promise<Map<string, ReportContentUnit[]>> {
  const result = new Map<string, ReportContentUnit[]>();
  if (!reportIds.length) return result;

  type EntryRow = {
    report_id: string;
    unit_id: string;
    field_key: string;
    value_num: number | null;
    value_text: string | null;
  };
  // 200件ずつのバッチを直列に待つと往復が積み上がるため並列で流す
  const slices: string[][] = [];
  for (let i = 0; i < reportIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    slices.push(reportIds.slice(i, i + IN_CLAUSE_BATCH_SIZE));
  }
  const pages = await Promise.all(
    slices.map((slice) =>
      fetchAllRows<EntryRow>((from, to) =>
        supabase
          .from("report_entries")
          .select("report_id, unit_id, field_key, value_num, value_text")
          .in("report_id", slice)
          // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
  );
  const entries: EntryRow[] = pages.flat();
  if (!entries.length) return result;

  // 日報がどのコース・便のものかを引き、コース設定で使わない項目は一覧にも出さない
  // （設定が無いコースは全項目のまま）。
  const reportMeta = new Map<string, { courseId: string | null; cycleNo: number }>();
  for (let i = 0; i < reportIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const { data: rows } = await supabase
      .from("daily_reports_v2").select("id, course_id, cycle_no")
      .in("id", reportIds.slice(i, i + IN_CLAUSE_BATCH_SIZE));
    for (const r of rows ?? []) {
      reportMeta.set(r.id, { courseId: r.course_id ?? null, cycleNo: Number(r.cycle_no) || 0 });
    }
  }
  const fieldFilter = await loadCourseReportFields(
    supabase,
    Array.from(new Set([...reportMeta.values()].map((m) => m.courseId).filter(Boolean) as string[])),
  );

  const unitIds = Array.from(new Set(entries.map((e) => e.unit_id).filter(Boolean)));
  const [{ data: units }, { data: fields }] = await Promise.all([
    supabase.from("units").select("id, name, sort_order").in("id", unitIds),
    supabase
      .from("unit_fields")
      .select("unit_id, field_key, label, input_type, group_label, sort_order")
      .in("unit_id", unitIds),
  ]);

  const unitMeta = new Map<string, { name: string; sortOrder: number }>();
  (units ?? []).forEach((u: { id: string; name: string | null; sort_order: number | null }) =>
    unitMeta.set(u.id, { name: u.name ?? "", sortOrder: u.sort_order ?? 0 }),
  );
  const fieldMeta = new Map<
    string,
    { label: string; inputType: string; groupLabel: string | null; sortOrder: number }
  >();
  (fields ?? []).forEach(
    (f: {
      unit_id: string;
      field_key: string;
      label: string | null;
      input_type: string | null;
      group_label: string | null;
      sort_order: number | null;
    }) =>
      fieldMeta.set(`${f.unit_id}:${f.field_key}`, {
        label: f.label ?? f.field_key,
        inputType: f.input_type ?? "INT",
        groupLabel: f.group_label ?? null,
        sortOrder: f.sort_order ?? 0,
      }),
  );

  // report -> unit -> fields
  const byReport = new Map<string, Map<string, ReportContentField[]>>();
  for (const e of entries) {
    const m = reportMeta.get(e.report_id);
    if (!fieldFilter.allows(m?.courseId ?? null, m?.cycleNo ?? 0, e.unit_id, e.field_key)) continue;
    if (!byReport.has(e.report_id)) byReport.set(e.report_id, new Map());
    const um = byReport.get(e.report_id)!;
    if (!um.has(e.unit_id)) um.set(e.unit_id, []);
    const meta = fieldMeta.get(`${e.unit_id}:${e.field_key}`);
    um.get(e.unit_id)!.push({
      fieldKey: e.field_key,
      label: meta?.label ?? e.field_key,
      inputType: meta?.inputType ?? "INT",
      groupLabel: meta?.groupLabel ?? null,
      valueNum: e.value_num != null ? Number(e.value_num) : null,
      valueText: e.value_text ?? null,
    });
  }

  byReport.forEach((um, reportId) => {
    const unitsArr: ReportContentUnit[] = [];
    um.forEach((flds, unitId) => {
      flds.sort(
        (a, b) =>
          (fieldMeta.get(`${unitId}:${a.fieldKey}`)?.sortOrder ?? 0) -
          (fieldMeta.get(`${unitId}:${b.fieldKey}`)?.sortOrder ?? 0),
      );
      unitsArr.push({ unitId, unitName: unitMeta.get(unitId)?.name ?? "", fields: flds });
    });
    unitsArr.sort(
      (a, b) => (unitMeta.get(a.unitId)?.sortOrder ?? 0) - (unitMeta.get(b.unitId)?.sortOrder ?? 0),
    );
    result.set(reportId, unitsArr);
  });

  return result;
}
