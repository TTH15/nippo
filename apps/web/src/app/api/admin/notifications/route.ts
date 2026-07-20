import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isLineConfigured } from "@/server/line/client";

export const dynamic = "force-dynamic";

// ============================================================
// 運営向け 通知ダッシュボード（roadmap-2026-07 E④）。
// GET: 配信対象になりうるメンバーと LINE 連携状況の一覧＋直近の送信履歴。
// notification-flow §1-2「運営画面に連携状況の一覧を出し未連携を可視化＝催促可能」。
// 送信は POST /api/admin/notifications/broadcast。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  // レイヤ1: 受信者候補は必ず org スコープのクエリから作る
  const { data: members, error } = await supabase
    .from("drivers")
    .select("id, name, identity_id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("name", { ascending: true });
  if (error) {
    console.error("[admin/notifications] メンバー取得に失敗", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  const identityIds = (members ?? []).map((m) => m.identity_id).filter(Boolean) as string[];
  const { data: identities } = identityIds.length
    ? await supabase
        .from("identities")
        .select("id, line_user_id, line_linked_at, line_blocked_at")
        .in("id", identityIds)
    : { data: [] as { id: string; line_user_id: string | null; line_linked_at: string | null; line_blocked_at: string | null }[] };

  const byIdentity = new Map((identities ?? []).map((i) => [i.id as string, i]));

  // line_user_id そのものは運営画面に出さない（連携済みかどうかだけで用は足りる）
  const rows = (members ?? []).map((m) => {
    const identity = m.identity_id ? byIdentity.get(m.identity_id as string) : undefined;
    return {
      driverId: m.id,
      name: m.name,
      lineLinked: Boolean(identity?.line_user_id),
      lineBlocked: Boolean(identity?.line_blocked_at),
      linkedAt: identity?.line_linked_at ?? null,
    };
  });

  const { data: recent } = await supabase
    .from("notifications")
    .select("id, kind, title, body, created_at")
    .eq("org_id", orgId)
    .eq("kind", "broadcast")
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    lineConfigured: isLineConfigured(),
    members: rows,
    linkedCount: rows.filter((r) => r.lineLinked && !r.lineBlocked).length,
    recentBroadcasts: recent ?? [],
  });
}
