// ============================================================
// サイクル対応前に cycle_no=0 で保存された承認済み日報を補正し、
// 承認時単価スナップショットを再作成する。
//
// 確認のみ（既定）:
//   npx tsx src/scripts/repair-cycle-report-snapshots.ts --start=2026-08-21 --end=2026-08-25
// 反映:
//   npx tsx src/scripts/repair-cycle-report-snapshots.ts --start=2026-08-21 --end=2026-08-25 --apply --confirm=cycle-report-repair
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { captureReportRateSnapshots } from "../server/aggregation/rateSnapshot";
import { loadAggregationData } from "../server/aggregation/load";
import { buildContext, buildContributions, sumBy } from "../server/aggregation/compute";

const argValue = (name: string): string | null => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
};

const envFile = argValue("env") ?? ".env.local";
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error(`${envFile} にSupabase接続情報がありません`);

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const startDate = argValue("start");
const endDate = argValue("end");
const apply = process.argv.includes("--apply");
const confirmed = argValue("confirm") === "cycle-report-repair";

const numberArray = (value: unknown): number[] => Array.isArray(value)
  ? value.map(Number).filter((item) => Number.isInteger(item) && item > 0)
  : [];

const snapshotComponentsEmpty = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return true;
  const components = (value as { components?: unknown }).components;
  return !Array.isArray(components) || components.length === 0;
};

const snapshotRequiredCycles = (value: unknown): number[] => {
  if (!value || typeof value !== "object") return [];
  const bundle = (value as { fixedBundle?: { requiredCycleNos?: unknown } }).fixedBundle;
  return numberArray(bundle?.requiredCycleNos);
};

type RepairPlan = {
  reportId: string;
  date: string;
  driverId: string;
  courseId: string;
  courseName: string;
  targetCycleNo: number;
  reason: string;
};

async function main() {
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("--start=YYYY-MM-DD と --end=YYYY-MM-DD を指定してください");
  }
  if (startDate > endDate) throw new Error("startはend以前にしてください");
  if (apply && !confirmed) throw new Error("反映時は --confirm=cycle-report-repair が必要です");

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("code", "ACE")
    .single();
  if (orgError || !org) throw orgError ?? new Error("ACE organization not found");
  const orgId = String(org.id);

  const { data: reports, error: reportError } = await supabase
    .from("daily_reports_v2")
    .select("id, driver_id, report_date, course_id, cycle_no, identity_id, approved_at, rejected_at, rate_snapshot")
    .eq("org_id", orgId)
    .gte("report_date", startDate)
    .lte("report_date", endDate)
    .not("approved_at", "is", null)
    .is("rejected_at", null);
  if (reportError) throw reportError;

  const legacyReports = (reports ?? []).filter((report) => Number(report.cycle_no) === 0 && report.course_id);
  const courseIds = Array.from(new Set(legacyReports.map((report) => String(report.course_id))));
  if (courseIds.length === 0) {
    console.log("対象の承認済みcycle_no=0日報はありません。");
    return;
  }

  const [{ data: courses, error: courseError }, { data: bundles, error: bundleError }, { data: shifts, error: shiftError }] = await Promise.all([
    supabase.from("courses").select("id, name").eq("org_id", orgId).in("id", courseIds),
    supabase.from("course_fixed_rate_bundles").select("course_id, required_cycle_nos").in("course_id", courseIds),
    supabase
      .from("shifts")
      .select("driver_id, shift_date, course_id, cycle_no")
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .in("course_id", courseIds),
  ]);
  if (courseError) throw courseError;
  if (bundleError) throw bundleError;
  if (shiftError) throw shiftError;

  const courseNameById = new Map((courses ?? []).map((course) => [String(course.id), String(course.name ?? course.id)]));
  const requiredCyclesByCourse = new Map((bundles ?? []).map((bundle) => [
    String(bundle.course_id),
    numberArray(bundle.required_cycle_nos),
  ]));
  const shiftCyclesByKey = new Map<string, Set<number>>();
  for (const shift of shifts ?? []) {
    const cycleNo = Number(shift.cycle_no) || 0;
    if (cycleNo <= 0 || !shift.course_id || !shift.driver_id) continue;
    const key = `${shift.driver_id}:${shift.shift_date}:${shift.course_id}`;
    const values = shiftCyclesByKey.get(key) ?? new Set<number>();
    values.add(cycleNo);
    shiftCyclesByKey.set(key, values);
  }

  const existingKeys = new Map<string, string>();
  for (const report of reports ?? []) {
    if (!report.course_id) continue;
    const identity = report.identity_id ?? "";
    existingKeys.set(
      `${report.driver_id}:${report.report_date}:${report.course_id}:${Number(report.cycle_no) || 0}:${identity}`,
      String(report.id),
    );
  }

  const eligibleReports = legacyReports.filter((report) =>
    snapshotRequiredCycles(report.rate_snapshot).length > 0 ||
    (requiredCyclesByCourse.get(String(report.course_id))?.length ?? 0) > 0,
  );
  const plans: RepairPlan[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  for (const report of eligibleReports) {
    const courseId = String(report.course_id);
    const baseKey = `${report.driver_id}:${report.report_date}:${courseId}`;
    const assignedCycles = [...(shiftCyclesByKey.get(baseKey) ?? [])].sort((a, b) => a - b);
    const requiredCycles = snapshotRequiredCycles(report.rate_snapshot).length > 0
      ? snapshotRequiredCycles(report.rate_snapshot)
      : (requiredCyclesByCourse.get(courseId) ?? []);
    const isFullDay = requiredCycles.length > 1 && requiredCycles.every((cycleNo) => assignedCycles.includes(cycleNo));

    let targetCycleNo = 0;
    let reason = "全日契約として再作成";
    if (assignedCycles.length === 1) {
      targetCycleNo = assignedCycles[0];
      reason = `シフトのC${targetCycleNo}へ補正`;
    } else if (!isFullDay && assignedCycles.length > 1) {
      skipped.push(`${report.report_date} ${courseNameById.get(courseId)}: シフト便 ${assignedCycles.join(",")} を一意に決められません`);
      continue;
    } else if (assignedCycles.length === 0 && requiredCycles.length === 0) {
      skipped.push(`${report.report_date} ${courseNameById.get(courseId)}: 便・全日契約の根拠がありません`);
      continue;
    }

    // snapshotが正しく、cycle_noも変更不要なら触らない。
    if (targetCycleNo === 0 && !snapshotComponentsEmpty(report.rate_snapshot)) continue;

    const identity = report.identity_id ?? "";
    const conflictId = existingKeys.get(`${report.driver_id}:${report.report_date}:${courseId}:${targetCycleNo}:${identity}`);
    if (targetCycleNo > 0 && conflictId && conflictId !== report.id) {
      conflicts.push(`${report.report_date} ${courseNameById.get(courseId)} C${targetCycleNo}: report ${conflictId} と重複`);
      continue;
    }
    plans.push({
      reportId: String(report.id),
      date: String(report.report_date),
      driverId: String(report.driver_id),
      courseId,
      courseName: courseNameById.get(courseId) ?? courseId,
      targetCycleNo,
      reason,
    });
  }

  console.log(`\n=== cycle日報snapshot修復 ${startDate}〜${endDate} ===`);
  console.log(
    `cycle_no=0承認済み ${legacyReports.length}件 / 全日契約候補 ${eligibleReports.length}件 / ` +
    `修復 ${plans.length}件 / 保留 ${skipped.length}件 / 競合 ${conflicts.length}件\n`,
  );
  plans.forEach((plan) => console.log(`  ${plan.date} ${plan.courseName} -> cycle ${plan.targetCycleNo} (${plan.reason})`));
  skipped.forEach((line) => console.log(`  保留: ${line}`));
  conflicts.forEach((line) => console.log(`  競合: ${line}`));

  // DBへ書かず、修復後のcycleを現在の共通集計エンジンへ当てて日別合計を確認する。
  const data = await loadAggregationData(supabase, orgId, startDate, endDate);
  const planById = new Map(plans.map((plan) => [plan.reportId, plan]));
  const simulatedReports = data.reports.map((report) => {
    const plan = planById.get(report.id);
    return plan ? { ...report, cycleNo: plan.targetCycleNo, rateSnapshot: null } : report;
  });
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates, data.fixedRateBundles);
  const byDate = sumBy(buildContributions(simulatedReports, data.ledger, ctx), (item) => item.date);
  console.log("\n修復後見込み（現在単価によるドライラン）:");
  for (const [date, money] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(
      `  ${date} 売上 ¥${money.revenue.toLocaleString("ja-JP")} / ` +
      `報酬 ¥${money.payout.toLocaleString("ja-JP")} / 粗利 ¥${money.profit.toLocaleString("ja-JP")}`,
    );
  }

  if (conflicts.length > 0) throw new Error("競合があるため反映できません");
  if (!apply) {
    console.log("\nDRY-RUNで終了しました。DBは変更していません。");
    return;
  }

  for (const plan of plans) {
    if (plan.targetCycleNo === 0) continue;
    const { error } = await supabase
      .from("daily_reports_v2")
      .update({ cycle_no: plan.targetCycleNo })
      .eq("id", plan.reportId)
      .eq("org_id", orgId)
      .eq("cycle_no", 0);
    if (error) throw error;
  }
  await captureReportRateSnapshots(supabase, orgId, plans.map((plan) => plan.reportId));
  console.log(`\n${plans.length}件を修復しました。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
