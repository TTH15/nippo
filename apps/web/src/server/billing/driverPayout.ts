import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAggregationData } from "@/server/aggregation/load";
import { isCountableReport } from "@/server/aggregation/compute";

// ============================================================
// ドライバーの「自動算出 報酬(payout)」を v2 集計モデルから算出する共有ロジック。
//   従量: course_unit_rates.payoutPerUnit × billable な report_entries 数量
//   固定: course_fixed_rates.fixedPayout × 稼働(承認 report)日数
// 旧 course_rates(takuhaibin/nekopos_driver_payout, fixed) / 旧 daily_reports への
// 依存を排し、admin/payments(同じv2 sumBy payout)と一致させる。
// me/rewards・admin/driver-rewards・payments/driver-breakdown が共用。
// 手当(driver_ad_hoc_expenses)・固定経費(driver_fixed_expenses)は各 route が別途読む。
// ============================================================

/** 日次の報酬明細（1 report = 1コース＝1行。複数コース日は複数行） */
export type DriverDayPayout = {
  date: string;
  courseId: string;
  /** 報告内容のテキスト（INT 項目の値>0 を列挙。表示用） */
  content: string;
  payout: number;
};

/** コース×項目別の報酬明細行（payments/driver-breakdown 用） */
export type DriverPayoutLine = {
  courseId: string;
  courseName: string;
  /** 従量行は unit、固定行は null */
  unitId: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type DriverAutoPayout = {
  total: number;
  days: DriverDayPayout[];
  lines: DriverPayoutLine[];
};

/** コース名の略記（"〜(略記)" があれば括弧内、なければそのまま） */
function shortCourseLabel(name: string): string {
  const t = String(name || "").trim();
  if (!t) return "未設定";
  const m = t.match(/\(([^)]+)\)/);
  return m?.[1] ? m[1] : t;
}

export async function computeDriverAutoPayout(
  supabase: SupabaseClient,
  orgId: string,
  driverId: string,
  startDate: string,
  endDate: string,
): Promise<DriverAutoPayout> {
  const data = await loadAggregationData(supabase, orgId, startDate, endDate);
  const unitById = new Map(data.units.map((u) => [u.id, u]));
  const rateByCourseUnit = new Map(data.unitRates.map((r) => [`${r.courseId}:${r.unitId}`, r]));
  const fixedByCourse = new Map(data.fixedRates.map((r) => [r.courseId, r]));

  // 表示用ラベル: コース名 / unit名 / unit_fields(label,input_type,group_label,sort)
  const [{ data: courseRows }, { data: unitRows }, { data: fieldRows }] = await Promise.all([
    supabase.from("courses").select("id, name"),
    supabase.from("units").select("id, name, sort_order"),
    supabase
      .from("unit_fields")
      .select("unit_id, field_key, label, group_label, input_type, sort_order"),
  ]);
  const courseNameById = new Map<string, string>();
  (courseRows ?? []).forEach((c: { id: string; name: string | null }) =>
    courseNameById.set(String(c.id), String(c.name ?? "")),
  );
  const unitNameById = new Map<string, string>();
  const unitSortById = new Map<string, number>();
  (unitRows ?? []).forEach((u: { id: string; name: string | null; sort_order: number | null }) => {
    unitNameById.set(u.id, String(u.name ?? ""));
    unitSortById.set(u.id, Number(u.sort_order) || 0);
  });
  type FieldDef = { label: string; group: string | null; inputType: string; sort: number };
  const fieldDefByKey = new Map<string, FieldDef>();
  (fieldRows ?? []).forEach(
    (f: {
      unit_id: string;
      field_key: string;
      label: string | null;
      group_label: string | null;
      input_type: string | null;
      sort_order: number | null;
    }) => {
      fieldDefByKey.set(`${f.unit_id}:${f.field_key}`, {
        label: String(f.label ?? f.field_key),
        group: f.group_label ?? null,
        inputType: String(f.input_type ?? "INT"),
        sort: Number(f.sort_order) || 0,
      });
    },
  );

  // 集計用アキュムレータ（明細行）
  const linePuQty = new Map<string, number>(); // `${courseId}:${unitId}` -> qty
  const fixedDaysByCourse = new Map<string, number>();

  const days: DriverDayPayout[] = [];

  for (const r of data.reports) {
    if (r.driverId !== driverId) continue;
    if (!isCountableReport(r)) continue;
    const courseId = r.courseId;
    if (!courseId) continue;

    let dayPayout = 0;
    const contentItems: { sort: number; text: string }[] = [];

    // 従量
    for (const e of r.entries) {
      const unit = unitById.get(e.unitId);
      const fdef = fieldDefByKey.get(`${e.unitId}:${e.fieldKey}`);
      const qty = e.valueNum ?? 0;
      // 内容テキスト（INT 項目で値>0 を列挙）
      if (fdef && fdef.inputType === "INT" && qty > 0) {
        const unitSort = unitSortById.get(e.unitId) ?? 0;
        const prefix = fdef.group ? `${fdef.group} ` : "";
        contentItems.push({
          sort: unitSort * 1000 + fdef.sort,
          text: `${prefix}${fdef.label} ${qty}個`,
        });
      }
      // 報酬（billable のみ・単価あり）
      const billable = unit?.fields.find((x) => x.fieldKey === e.fieldKey)?.isBillable;
      if (!billable || qty === 0) continue;
      const rate = rateByCourseUnit.get(`${courseId}:${e.unitId}`);
      if (!rate) continue;
      dayPayout += qty * rate.payoutPerUnit;
      linePuQty.set(`${courseId}:${e.unitId}`, (linePuQty.get(`${courseId}:${e.unitId}`) ?? 0) + qty);
    }

    // 固定
    const fx = fixedByCourse.get(courseId);
    if (fx && (fx.fixedRevenue !== 0 || fx.fixedProfit !== 0 || fx.fixedPayout !== 0)) {
      dayPayout += fx.fixedPayout;
      fixedDaysByCourse.set(courseId, (fixedDaysByCourse.get(courseId) ?? 0) + 1);
    }

    const content =
      contentItems
        .sort((a, b) => a.sort - b.sort)
        .map((x) => x.text)
        .join(" ") || "—";
    days.push({ date: r.reportDate, courseId, content, payout: dayPayout });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  // 明細行
  const lines: DriverPayoutLine[] = [];
  for (const [key, qty] of linePuQty) {
    const [courseId, unitId] = key.split(":");
    const rate = rateByCourseUnit.get(key);
    if (!rate || qty <= 0 || rate.payoutPerUnit <= 0) continue;
    const courseName = courseNameById.get(courseId) ?? "";
    const short = shortCourseLabel(courseName);
    lines.push({
      courseId,
      courseName,
      unitId,
      title: `${unitNameById.get(unitId) ?? ""}（${short}）`,
      qty,
      unitPrice: rate.payoutPerUnit,
      amount: qty * rate.payoutPerUnit,
    });
  }
  for (const [courseId, dayCount] of fixedDaysByCourse) {
    const fx = fixedByCourse.get(courseId);
    if (!fx || dayCount <= 0 || fx.fixedPayout <= 0) continue;
    const courseName = courseNameById.get(courseId) ?? "";
    const short = shortCourseLabel(courseName);
    lines.push({
      courseId,
      courseName,
      unitId: null,
      title: `${short}（固定）`,
      qty: dayCount,
      unitPrice: fx.fixedPayout,
      amount: dayCount * fx.fixedPayout,
    });
  }
  lines.sort((a, b) => a.title.localeCompare(b.title, "ja"));

  const total = days.reduce((s, d) => s + d.payout, 0);
  return { total, days, lines };
}
