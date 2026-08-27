import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { buildContext, buildContributions } from "@/server/aggregation/compute";
import { loadSubmitScreenConfig } from "@/server/submitScreen/config";
import { resolveBlocks, normalizeBlocks, defaultBlocksFromConfig } from "@/server/submitScreen/blocks";
import { loadDriverLease, loadCourseDailyLease, leaseDailyRateForCourse } from "@/server/billing/driverLease";
import { inclusiveOf } from "@repo/core/logic/taxBasis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const driverId = user.driverId as string;
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

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
    .filter((report) => report.rejectedAt == null)
    .map((report) => ({ ...report, approvedAt: report.approvedAt ?? "preview" }));
  const context = buildContext(dayData.units, dayData.unitRates, dayData.fixedRates, dayData.fixedRateBundles, dayData.courseBillingMeta);
  const todayContributions = buildContributions(previewReports, [], context)
    .filter((contribution) => contribution.driverId === driverId);
  const todayRewardBeforeLease = todayContributions.reduce((total, contribution) => total + contribution.payout, 0);
  let leaseToday = 0; // 当日コースの最大日額（DAILY時）
  for (const r of dayData.reports) {
    if (r.driverId !== driverId || r.reportDate !== date || r.rejectedAt) continue;
    if (!r.courseId) continue;
    leaseToday = Math.max(leaseToday, leaseDailyRateForCourse(lease, r.courseId, courseDailyLease));
  }
  const todayReward = inclusiveOf(todayRewardBeforeLease, "exclusive") - leaseToday;

  // --- 送信後画面のブロックを解決 ---
  // blocks 未設定なら従来フラット設定から既定ブロックを導出（後方互換）。
  const blocks =
    config.blocks && config.blocks.length > 0 ? normalizeBlocks(config.blocks) : defaultBlocksFromConfig(config);
  const resolvedBlocks = await resolveBlocks(supabase, blocks, {
    orgId,
    driverId,
    date,
    todayReward: Math.round(todayReward),
    // 当日×本人分の集計を event ブロック（todayPoints）と共有し、二重ロードを防ぐ
    dayData,
  });

  return NextResponse.json({
    date,
    todayReward: Math.round(todayReward),
    blocks: resolvedBlocks,
  });
}
