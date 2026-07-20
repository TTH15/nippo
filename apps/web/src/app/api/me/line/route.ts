import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";
import { issueLinkCode } from "@/server/line/linkCode";
import { isLineConfigured } from "@/server/line/client";

export const dynamic = "force-dynamic";

// ============================================================
// 本人の LINE 連携（roadmap-2026-07 E②）。
// GET    : 連携状態（未連携/連携済み/ブロック中）
// POST   : ワンタイム連携コードの発行（本人が LINE トークへ送信する）
// DELETE : 連携解除（line_user_id を外す。LINE 側の友だち関係は本人操作）
// 連携は identity 単位（org をまたいで1つ）。notification-flow §1-1。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ configured: isLineConfigured(), linked: false });

  const { data } = await supabase
    .from("identities")
    .select("line_user_id, line_linked_at, line_blocked_at")
    .eq("id", identityId)
    .maybeSingle();

  return NextResponse.json({
    configured: isLineConfigured(),
    linked: Boolean(data?.line_user_id),
    linkedAt: data?.line_linked_at ?? null,
    blocked: Boolean(data?.line_blocked_at),
  });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  if (!isLineConfigured()) {
    return NextResponse.json({ error: "LINE連携は現在利用できません" }, { status: 503 });
  }

  const identityId = await resolveIdentityId(user);
  if (!identityId) {
    return NextResponse.json(
      { error: "identityが未設定のためLINE連携できません" },
      { status: 400 },
    );
  }

  try {
    const { code, expiresAt } = await issueLinkCode(identityId);
    return NextResponse.json({ code, expiresAt });
  } catch (e) {
    console.error("[me/line] コード発行に失敗", e);
    return NextResponse.json({ error: "連携コードの発行に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from("identities")
    .update({ line_user_id: null, line_linked_at: null, line_blocked_at: null })
    .eq("id", identityId);
  if (error) {
    console.error("[me/line] 連携解除に失敗", error);
    return NextResponse.json({ error: "連携解除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
