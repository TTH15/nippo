import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadReadiness, loadReadinessSettings } from "@/server/shifts/readinessData";
import { shiftDate } from "@/server/shifts/readiness";

export const dynamic = "force-dynamic";

// ============================================================
// GET: 締切より前に手を打つべき未解決の一覧。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1「期限前に管理者へ未解決を集める」
//
// 状態から毎回導くので「閉じた」印は持たない。解決するまで消えない。
// 過去日は対象外（事前に気づくための一覧なので、当日以降だけを見る）。
// ============================================================

const isDateOnly = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** 事業日の基準は JST。サーバーのタイムゾーンに依存させない */
function todayInJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const today = todayInJst();
  try {
    // 先読みの日数は会社の設定。未適用・未設定なら既定値
    const settings = await loadReadinessSettings(supabase, orgId);
    const horizon = shiftDate(today, settings.horizonDays);
    const startParam = req.nextUrl.searchParams.get("start");
    const endParam = req.nextUrl.searchParams.get("end");
    // 指定があっても当日より前・設定の先読みより先へは広げない
    const start = isDateOnly(startParam) && startParam > today ? startParam : today;
    const end = isDateOnly(endParam) && endParam < horizon ? endParam : horizon;
    if (start > end) return NextResponse.json({ items: [], dates: [], today, unavailable: false });

    const result = await loadReadiness(supabase, { orgId, start, end, settings });
    return NextResponse.json({ ...result, today });
  } catch (error) {
    console.error("[shift readiness] load failed", error);
    // 正式シフト画面を止めない。一覧だけ準備中として畳む
    return NextResponse.json({ items: [], courseNames: {}, cycleLabels: {}, driverNames: {}, dates: [], today, unavailable: true });
  }
}
