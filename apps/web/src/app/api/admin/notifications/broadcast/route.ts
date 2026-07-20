import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { dispatchNotifications } from "@/server/notifications/dispatch";

export const dynamic = "force-dynamic";

// ============================================================
// 手動ブロードキャスト（roadmap-2026-07 E④ / notification-flow §3 モード3）。
// 用途: 台風で本日休み・KYC承認の催促・希望休の締切連絡など。
//
// ★誤爆防止（§1-3）:
//   レイヤ1 受信者は必ず org スコープのクエリから作る（下の候補取得）
//   レイヤ5 UI から driverIds が来ても、org 内の active メンバーとの積集合しか採らない
//   レイヤ3 最終アサートは dispatchNotifications 内（越境検出でバッチ中断）
//   LINE の broadcast API は使わない（明示 userId の multicast のみ）
// ============================================================

const MAX_TITLE = 100;
const MAX_BODY = 1000;

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const input = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    driverIds?: string[];
  };

  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title || !body) {
    return NextResponse.json({ error: "件名と本文を入力してください" }, { status: 400 });
  }
  if (title.length > MAX_TITLE || body.length > MAX_BODY) {
    return NextResponse.json(
      { error: `件名は${MAX_TITLE}文字、本文は${MAX_BODY}文字までです` },
      { status: 400 },
    );
  }

  // レイヤ1: 候補は org の active メンバーのみ
  const { data: candidates, error } = await supabase
    .from("drivers")
    .select("id, identity_id")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (error) {
    console.error("[broadcast] 受信者取得に失敗", error);
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }

  // レイヤ5: 指定があっても候補との積集合。org 外の ID は黙って捨てる（漏らさない）
  const requested = Array.isArray(input.driverIds) && input.driverIds.length > 0
    ? new Set(input.driverIds)
    : null;
  const recipients = (candidates ?? [])
    .filter((d) => d.identity_id && (!requested || requested.has(d.id as string)));

  if (recipients.length === 0) {
    return NextResponse.json({ error: "送信対象がいません" }, { status: 400 });
  }

  try {
    // dedupeKey は付けない（同じ文面を意図的に再送したい場面があるため）
    const result = await dispatchNotifications(
      orgId,
      recipients.map((d) => ({
        driverId: d.id as string,
        identityId: d.identity_id as string,
        kind: "broadcast",
        title,
        body,
        payload: { sentBy: user.driverId },
      })),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[broadcast] 送信に失敗", e);
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }
}
