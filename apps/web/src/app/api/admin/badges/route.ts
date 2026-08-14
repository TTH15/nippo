import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";
import {
  countDailyUnread,
  countOilChangeUnread,
  countOilAlert,
  countLicenseAlert,
  countPendingDrivers,
} from "@/server/adminBadges/counts";

export const dynamic = "force-dynamic";

// GET: 管理メニューのバッジ件数をまとめて返す統合エンドポイント。
// 従来は AdminLayout が5本を各60秒ポーリング＋ダッシュボードで3本重複していた
// （2026-08 通信監査）。1リクエストに束ね、権限のない項目は null（非表示）にする。
export async function GET(req: NextRequest) {
  const user = await requireAnyPermission(req, [
    "can_view_reports",
    "can_view_vehicles",
    "can_view_members",
  ]);
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const caps = user.capabilities;
  const canReports = caps?.has("can_view_reports") ?? false;
  const canVehicles = caps?.has("can_view_vehicles") ?? false;
  const canMembers = caps?.has("can_view_members") ?? false;

  // 要対応(未解決)である限り経過日数に関わらずバッジに出続けるべきなので、
  // 期間で切らず全履歴を数える（要対応ビュー pending=1 と同じ定義・2026-08-02）。
  const start = "2020-01-01"; // サービス開始より十分前（実データの下限で自然に切れる）
  const end = reportDateDefaultJST();

  // 個別の失敗でバッジ全体を巻き込まない（失敗した項目は null＝非表示）
  const soft = <T,>(p: Promise<T>): Promise<T | null> =>
    p.catch((e) => {
      console.error("[admin/badges] count error", e);
      return null;
    });

  const [dailyUnread, otherUnread, oilAlert, licenseAlert, pendingApproval] = await Promise.all([
    canReports ? soft(countDailyUnread(supabase, orgId, start, end)) : null,
    canVehicles ? soft(countOilChangeUnread(supabase, orgId)) : null,
    canVehicles ? soft(countOilAlert(supabase, orgId)) : null,
    canMembers ? soft(countLicenseAlert(supabase, orgId)) : null,
    canMembers ? soft(countPendingDrivers(supabase, orgId)) : null,
  ]);

  return NextResponse.json({ dailyUnread, otherUnread, oilAlert, licenseAlert, pendingApproval });
}
