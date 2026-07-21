import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";

export const dynamic = "force-dynamic";

// ============================================================
// アプリ内インボックス（roadmap-2026-07 E⑤）。
// notification-flow §1-2 の「真実」レイヤ。LINE 未連携でもここには必ず届く。
// GET  : 自分宛て通知の一覧（新しい順）＋未読件数
// PATCH: 既読化（ids 指定 or all）
// 受信者の同一性は identity_id で判定する（membership をまたいで1つのインボックス）。
// ============================================================

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ notifications: [], unreadCount: 0 });

  const { data, error } = await supabase
    .from("notifications") // tenant-scope-ok: 本人（identity_id 一致）宛てのみ。インボックスは membership をまたいで1つ（§設計）
    .select("id, org_id, kind, title, body, payload, read_at, created_at")
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) {
    console.error("[me/notifications] 取得に失敗", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  const { count } = await supabase
    .from("notifications") // tenant-scope-ok: 上と同じく本人（identity_id 一致）宛ての未読数
    .select("id", { count: "exact", head: true })
    .eq("identity_id", identityId)
    .is("read_at", null);

  return NextResponse.json({ notifications: data ?? [], unreadCount: count ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean };

  // 自分宛て（identity_id 一致）に限定して更新する＝他人の通知は既読にできない
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("identity_id", identityId)
    .is("read_at", null);

  if (!body.all) {
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: "ids または all を指定してください" }, { status: 400 });
    }
    query = query.in("id", body.ids);
  }

  const { error } = await query;
  if (error) {
    console.error("[me/notifications] 既読化に失敗", error);
    return NextResponse.json({ error: "既読化に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
