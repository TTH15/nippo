import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { fetchAllRows } from "@/server/aggregation/pagination";
import { reportFormKey } from "@repo/core/logic/dailyReport";
import { buildContext, buildContributions } from "@/server/aggregation/compute";
import { loadSubmitScreenConfig } from "@/server/submitScreen/config";
import { resolveBlocks, normalizeBlocks, defaultBlocksFromConfig } from "@/server/submitScreen/blocks";
import { loadDriverLease, loadCourseDailyLease, computeLeaseDeduction } from "@/server/billing/driverLease";
import type { TodayRewardBreakdown } from "@/lib/submitScreenBlocks";

type PendingCourse = {
  id: string;
  course_id: string;
  cycle_no: number;
  entries: { unitId: string; fieldKey: string; valueNum?: number | string | null }[];
};

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const driverId = user.driverId as string;
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  // 先に申請を読む。途中で承認されても、後から読む正式な日報を優先できる。
  const pendingCourses = await fetchAllRows<PendingCourse>((from, to) =>
    supabase.from("report_course_requests").select("id, course_id, cycle_no, entries:payload->entries")
      .eq("org_id", orgId).eq("driver_id", driverId).eq("report_date", date).eq("status", "pending")
      .order("id").range(from, to).overrideTypes<PendingCourse[], { merge: false }>(),
  ).catch(() => null);
  if (!pendingCourses) return NextResponse.json({ error: "報酬の見込みを読み込めませんでした" }, { status: 503 });

  // 設定・当日集計・リースは互いに独立のため1波で並列取得する（旧: 直列3段）。
  // 当日分は本人の日報だけ読む（org 全員分は不要。ledger も未使用）。
  const [config, dayData, lease, courseDailyLease] = await Promise.all([
    loadSubmitScreenConfig(supabase, orgId),
    loadAggregationData(supabase, orgId, date, date, { driverId, withLedger: false }),
    loadDriverLease(supabase, driverId, date, date),
    loadCourseDailyLease(supabase, orgId),
  ]);

  // --- 今日の報酬見込み（v2・未承認も含む / 却下は除外） ---
  // 売上・月次支払と同じ集計エンジンを使い、便別単価・全日日当・snapshotの
  // 解決規則を一本化する。見込みでは未承認も仮承認扱いにする。
  const previewReports = dayData.reports
    .filter((report) => report.driverId === driverId && report.reportDate === date && report.rejectedAt == null)
    .map((report) => ({ ...report, approvedAt: report.approvedAt ?? "preview" }));
  const reportedKeys = new Set(previewReports.flatMap(report =>
    report.courseId ? [reportFormKey(report.courseId, report.cycleNo)] : [],
  ));
  const additions = pendingCourses.filter(request => !reportedKeys.has(reportFormKey(request.course_id, request.cycle_no)));
  for (const request of additions) {
    previewReports.push({
      id: request.id, driverId, reportDate: date, courseId: request.course_id, cycleNo: request.cycle_no,
      carrierId: null, approvedAt: "preview", rejectedAt: null,
      entries: request.entries.map(entry => ({
        unitId: entry.unitId, fieldKey: entry.fieldKey, valueNum: Number(entry.valueNum ?? 0),
      })),
    });
  }
  const context = buildContext(dayData.units, dayData.unitRates, dayData.fixedRates, dayData.fixedRateBundles, dayData.courseBillingMeta);
  const todayContributions = buildContributions(previewReports, [], context)
    .filter((contribution) => contribution.driverId === driverId);
  // ドライバーへは税込で支払う。税抜値の1.1倍ではなく契約原額から積み直した payoutIncl を使う。
  const todayRewardBeforeLease = todayContributions.reduce((total, contribution) => total + contribution.payoutIncl, 0);
  // 月額契約は日別に割り振らない。日額契約は複数便/コースでもその日の最大額を1回。
  const leaseToday = lease?.mode === "DAILY" ? computeLeaseDeduction(
    lease, previewReports.map((report) => ({ date: report.reportDate, courseId: report.courseId })), courseDailyLease,
  ) : 0;
  const todayReward = todayRewardBeforeLease - leaseToday;
  const rewardBreakdown: TodayRewardBreakdown = {
    beforeLease: Math.round(todayRewardBeforeLease),
    dailyLease: Math.round(leaseToday),
    monthlyLease: lease?.mode === "MONTHLY",
    includedPendingCourseCount: additions.length,
  };

  // --- 送信後画面のブロックを解決 ---
  // blocks 未設定なら従来フラット設定から既定ブロックを導出（後方互換）。
  const blocks =
    config.blocks && config.blocks.length > 0 ? normalizeBlocks(config.blocks) : defaultBlocksFromConfig(config);
  const resolvedBlocks = await resolveBlocks(supabase, blocks, {
    orgId,
    driverId,
    date,
    todayReward: Math.round(todayReward),
    rewardBreakdown,
    // 当日×本人分の集計を event ブロック（todayPoints）と共有し、二重ロードを防ぐ
    dayData,
  });

  return NextResponse.json({
    date,
    todayReward: Math.round(todayReward),
    blocks: resolvedBlocks,
  });
}
