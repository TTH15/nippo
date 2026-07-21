import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// LINE チャットのスレッド一覧（roadmap-2026-07 E④）。
// 連携済みドライバーごとに、最後のメッセージと未読件数を返す。
// テナント分離: org_id で必ず絞る（他社のスレッドは見えない）。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  // 連携済みの active メンバー（＝チャットを送れる相手）
  const { data: members, error } = await supabase
    .from("drivers")
    .select("id, name, identity_id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .not("identity_id", "is", null)
    .order("name", { ascending: true });
  if (error) {
    console.error("[chats] メンバー取得に失敗", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  const identityIds = (members ?? []).map((m) => m.identity_id as string);
  const { data: linkedIdentities } = identityIds.length
    ? await supabase
        .from("identities")
        .select("id, line_user_id, line_blocked_at")
        .in("id", identityIds)
        .not("line_user_id", "is", null)
    : { data: [] as { id: string; line_user_id: string; line_blocked_at: string | null }[] };

  const linkedMap = new Map((linkedIdentities ?? []).map((i) => [i.id as string, i]));

  // スレッド一覧は「直近メッセージ」を出したいだけなので、org 分をまとめて引いて
  // アプリ側で driver ごとに畳む（メンバー数×クエリを避ける）
  const { data: messages } = await supabase
    .from("line_chat_messages")
    .select("driver_id, direction, text, read_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(500);

  const lastByDriver = new Map<string, { text: string; direction: string; created_at: string }>();
  const unreadByDriver = new Map<string, number>();
  for (const m of messages ?? []) {
    const driverId = m.driver_id as string;
    if (!lastByDriver.has(driverId)) {
      lastByDriver.set(driverId, {
        text: m.text as string,
        direction: m.direction as string,
        created_at: m.created_at as string,
      });
    }
    if (m.direction === "inbound" && !m.read_at) {
      unreadByDriver.set(driverId, (unreadByDriver.get(driverId) ?? 0) + 1);
    }
  }

  const threads = (members ?? [])
    .filter((m) => m.identity_id && linkedMap.has(m.identity_id as string))
    .map((m) => {
      const last = lastByDriver.get(m.id as string);
      return {
        driverId: m.id,
        name: m.name,
        blocked: Boolean(linkedMap.get(m.identity_id as string)?.line_blocked_at),
        lastMessage: last?.text ?? null,
        lastDirection: last?.direction ?? null,
        lastAt: last?.created_at ?? null,
        unreadCount: unreadByDriver.get(m.id as string) ?? 0,
      };
    })
    // 会話があるスレッドを上に、その中では新しい順
    .sort((a, b) => {
      if (a.lastAt && b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
      if (a.lastAt) return -1;
      if (b.lastAt) return 1;
      return a.name.localeCompare(b.name, "ja");
    });

  return NextResponse.json({
    threads,
    totalUnread: [...unreadByDriver.values()].reduce((a, b) => a + b, 0),
  });
}
