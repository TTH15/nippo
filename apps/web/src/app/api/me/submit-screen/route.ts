import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { loadSubmitScreenConfig } from "@/server/submitScreen/config";
import { resolveBlocks, normalizeBlocks, defaultBlocksFromConfig } from "@/server/submitScreen/blocks";
import { loadDriverLease, loadCourseDailyLease, leaseDailyRateForCourse } from "@/server/billing/driverLease";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const config = await loadSubmitScreenConfig(supabase);

  // --- 今日の報酬見込み（v2・未承認も含む / 却下は除外） ---
  const dayData = await loadAggregationData(supabase, date, date);
  const unitById = new Map(dayData.units.map((u) => [u.id, u]));
  const rateByCourseUnit = new Map(dayData.unitRates.map((r) => [`${r.courseId}:${r.unitId}`, r]));
  const fixedByCourse = new Map(dayData.fixedRates.map((r) => [r.courseId, r]));
  // リース控除（DAILY のみ日当に反映）。当日コースの日額リース代(courses.daily_lease)を1回控除。
  const [lease, courseDailyLease] = await Promise.all([
    loadDriverLease(supabase, driverId, date, date),
    loadCourseDailyLease(supabase),
  ]);

  let todayReward = 0;
  let leaseToday = 0; // 当日コースの最大日額（DAILY時）
  for (const r of dayData.reports) {
    if (r.driverId !== driverId || r.reportDate !== date || r.rejectedAt) continue;
    if (!r.courseId) continue;
    for (const e of r.entries) {
      const unit = unitById.get(e.unitId);
      const billable = unit?.fields.find((x) => x.fieldKey === e.fieldKey)?.isBillable;
      if (!billable) continue;
      const rate = rateByCourseUnit.get(`${r.courseId}:${e.unitId}`);
      if (rate) todayReward += (e.valueNum ?? 0) * rate.payoutPerUnit;
    }
    const fx = fixedByCourse.get(r.courseId);
    if (fx && (fx.fixedRevenue !== 0 || fx.fixedProfit !== 0 || fx.fixedPayout !== 0)) {
      todayReward += fx.fixedPayout;
    }
    leaseToday = Math.max(leaseToday, leaseDailyRateForCourse(lease, r.courseId, courseDailyLease));
  }
  todayReward -= leaseToday;

  // --- 送信後画面のブロックを解決 ---
  // blocks 未設定なら従来フラット設定から既定ブロックを導出（後方互換）。
  const blocks =
    config.blocks && config.blocks.length > 0 ? normalizeBlocks(config.blocks) : defaultBlocksFromConfig(config);
  const resolvedBlocks = await resolveBlocks(supabase, blocks, {
    driverId,
    date,
    todayReward: Math.round(todayReward),
  });

  return NextResponse.json({
    date,
    todayReward: Math.round(todayReward),
    blocks: resolvedBlocks,
  });
}
