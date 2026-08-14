import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";
import { countDailyUnread } from "@/server/adminBadges/counts";

export const dynamic = "force-dynamic";

// バッジ用の単体エンドポイント（互換維持）。通常は /api/admin/badges に統合済み。
// 集計は RPC（migration 132）優先＋アプリ側走査フォールバック（counts.ts に一元化）。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const url = req.nextUrl;
  let startParam = url.searchParams.get("start");
  let endParam = url.searchParams.get("end");
  const businessToday = reportDateDefaultJST();

  if (!startParam || !endParam) {
    // 要対応(未解決)である限り、経過日数に関わらずバッジに出続けるべきなので、
    // 既定は期間で切らず全履歴を数える（要対応ビュー pending=1 と同じ定義・2026-08-02）。
    startParam = "2020-01-01"; // サービス開始より十分前（実データの下限で自然に切れる）
    endParam = businessToday;
  }

  if (startParam > businessToday) startParam = businessToday;
  if (endParam > businessToday) endParam = businessToday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startParam) || !/^\d{4}-\d{2}-\d{2}$/.test(endParam)) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (startParam > endParam) {
    [startParam, endParam] = [endParam, startParam];
  }

  try {
    const unreadCount = await countDailyUnread(supabase, orgId, startParam, endParam);
    return NextResponse.json({ unreadCount });
  } catch (err) {
    console.error("[admin/daily/unread-count] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
