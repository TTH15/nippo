// 本番データ調査: 杉本さんの6月稼働分、「ヤマト壬生」に関する
// 売上テーブル(reports-summary相当)と請求書(billing系)の集計を突合。
// SELECTのみ・非破壊。.env.production.local の Supabase を読む。
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.production.local") });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: drivers, error: dErr } = await supabase
    .from("drivers")
    .select("id, name, display_name, org_id")
    .or("name.ilike.%杉本%,display_name.ilike.%杉本%");
  if (dErr) throw dErr;
  console.log("=== 杉本 該当ドライバー ===");
  console.log(drivers);
  if (!drivers || drivers.length === 0) return;

  const { data: mibuCourses } = await supabase
    .from("courses")
    .select("id, name, carrier_id, org_id")
    .ilike("name", "%壬生%");
  console.log("\n=== 「壬生」を含むコース ===");
  console.log(mibuCourses);
  const mibuCourseIds = (mibuCourses ?? []).map((c) => c.id);

  for (const drv of drivers) {
    console.log(`\n\n########## driver: ${drv.display_name || drv.name} (${drv.id}) org=${drv.org_id} ##########`);

    const { data: reports } = await supabase
      .from("daily_reports_v2")
      .select("id, report_date, course_id, driver_id, approved_at, rejected_at")
      .eq("driver_id", drv.id)
      .gte("report_date", "2026-06-01")
      .lte("report_date", "2026-06-30")
      .order("report_date");

    console.log(`6月日報(v2)総件数: ${reports?.length ?? 0}`);
    const mibuReports = (reports ?? []).filter((r) => mibuCourseIds.includes(r.course_id));
    console.log(`うち壬生コースの日報: ${mibuReports.length}件`);
    mibuReports.forEach((r) =>
      console.log(`  date=${r.report_date} approved_at=${r.approved_at} rejected_at=${r.rejected_at}`),
    );

    if (mibuReports.length === 0) {
      console.log("(壬生の日報なし。他コース内訳:)");
      const otherCourseIds = [...new Set((reports ?? []).map((r) => r.course_id))];
      const { data: cs } = await supabase.from("courses").select("id,name").in("id", otherCourseIds.length ? otherCourseIds : ["-"]);
      console.log((cs ?? []).map((c) => c.name));
      continue;
    }

    const reportIds = mibuReports.map((r) => r.id);
    const { data: entries } = await supabase
      .from("report_entries")
      .select("report_id, unit_id, field_key, value_num")
      .in("report_id", reportIds);
    console.log(`\n壬生日報のreport_entries件数: ${entries?.length ?? 0}`);

    const unitIds = [...new Set((entries ?? []).map((e) => e.unit_id))];
    const { data: units } = await supabase.from("units").select("id, name, billing_type").in("id", unitIds);
    const unitById = new Map((units ?? []).map((u) => [u.id, u]));
    const { data: fields } = await supabase.from("unit_fields").select("unit_id, field_key, is_billable, label").in("unit_id", unitIds);

    // reports-summary相当のロジック（承認状態を無視、rejected_atのみ除外）
    let summaryQty = 0;
    const byUnit = {};
    for (const e of entries ?? []) {
      const unit = unitById.get(e.unit_id);
      if (!unit) continue;
      const field = (fields ?? []).find((f) => f.unit_id === e.unit_id && f.field_key === e.field_key);
      if (!field?.is_billable) continue;
      const v = Number(e.value_num) || 0;
      byUnit[unit.name] = (byUnit[unit.name] ?? 0) + v;
      summaryQty += v;
    }
    console.log("売上テーブル相当(承認状態無視・rejectedのみ除外)の個数内訳:", byUnit);

    // 承認済みのみ(billing系相当)
    const approvedReportIds = new Set(
      mibuReports.filter((r) => r.approved_at && !r.rejected_at).map((r) => r.id),
    );
    let billingQty = 0;
    const byUnitBilling = {};
    for (const e of entries ?? []) {
      if (!approvedReportIds.has(e.report_id)) continue;
      const unit = unitById.get(e.unit_id);
      if (!unit) continue;
      const field = (fields ?? []).find((f) => f.unit_id === e.unit_id && f.field_key === e.field_key);
      if (!field?.is_billable) continue;
      const v = Number(e.value_num) || 0;
      byUnitBilling[unit.name] = (byUnitBilling[unit.name] ?? 0) + v;
      billingQty += v;
    }
    console.log("請求書相当(承認済みのみ)の個数内訳:", byUnitBilling);
    console.log(`承認待ち/却下の壬生日報: ${mibuReports.length - approvedReportIds.size}件`);

    // course_unit_rates / course_fixed_rates の設定有無
    const { data: unitRates } = await supabase
      .from("course_unit_rates")
      .select("course_id, unit_id, revenue_rate, payout_rate")
      .in("course_id", mibuCourseIds);
    const { data: fixedRates } = await supabase
      .from("course_fixed_rates")
      .select("course_id, unit_id, fixed_revenue, fixed_payout")
      .in("course_id", mibuCourseIds);
    console.log("\n壬生コースの course_unit_rates:", unitRates);
    console.log("壬生コースの course_fixed_rates:", fixedRates);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
