import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { getMessageQuota, isLineConfigured, type LineQuota } from "@/server/line/client";
import { getOrgLineQuota } from "@/server/notifications/orgQuota";

export const dynamic = "force-dynamic";

// ============================================================
// LINE の今月の通数照会（roadmap-2026-07 E④）。
//
// 2階層:
//  - org 上限が設定されていれば org 集計（自前カウント）を「残り通数」として返す。
//    複数 org 運用時はこちらが各社の枠になる。scope="org"。
//  - 未設定なら LINE 公式 API の実値（チャネル全体）を返す。scope="channel"。
//    ★チャネル値は org 単位の内訳を持たない（統合1本のため）。
//
// LINE 実値はレート制限があるためプロセス内で短時間キャッシュする。
// ============================================================

const CACHE_TTL_MS = 5 * 60_000;
let channelCache: { at: number; quota: LineQuota } | null = null;

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;

  if (!isLineConfigured()) {
    return NextResponse.json({ configured: false, scope: null, quota: null });
  }

  const orgId = await resolveOrgId(user.driverId);

  // org 上限が設定されていれば org 集計を返す（自前カウント＝内訳を持てる）
  const orgQuota = await getOrgLineQuota(orgId);
  if (orgQuota.limit !== null) {
    return NextResponse.json({ configured: true, scope: "org", quota: orgQuota });
  }

  // 未設定はチャネル全体の実値（従来挙動）。取得失敗でも画面は止めない
  const now = Date.now();
  if (channelCache && now - channelCache.at < CACHE_TTL_MS) {
    return NextResponse.json({
      configured: true,
      scope: "channel",
      quota: channelCache.quota,
      cached: true,
    });
  }
  try {
    const quota = await getMessageQuota();
    channelCache = { at: now, quota };
    return NextResponse.json({ configured: true, scope: "channel", quota });
  } catch (e) {
    console.error("[notifications/quota] 通数の取得に失敗", e);
    return NextResponse.json({ configured: true, scope: "channel", quota: null });
  }
}
