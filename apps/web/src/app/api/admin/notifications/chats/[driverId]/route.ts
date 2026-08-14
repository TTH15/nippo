import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isLineConfigured, pushText } from "@/server/line/client";

export const dynamic = "force-dynamic";

// ============================================================
// 1対1チャットの履歴取得と送信（roadmap-2026-07 E④）。
// GET   : 会話履歴（古い順）。副作用なし（15秒ポーリングのたびに書き込まない・2026-08 監査）
// PATCH : inbound の既読化（開いた/読んだタイミングでクライアントが明示的に叩く）
// POST  : LINE へ push して outbound を保存
//
// ★誤爆防止: 相手が「自 org の active メンバー」であることを毎回確認してから
//   送る（driverId は URL 由来＝改竄されうるため）。
// ============================================================

const MAX_TEXT = 2000; // LINE のテキストメッセージ上限は 5000 だが運用上は十分

/** driverId が自 org のメンバーか確認し、LINE 送信に必要な情報を返す。 */
async function resolveRecipient(orgId: string, driverId: string) {
  const { data: driver } = await supabase
    .from("drivers")
    .select("id, name, identity_id, status")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver || driver.status !== "active" || !driver.identity_id) return null;

  const { data: identity } = await supabase
    .from("identities")
    .select("id, line_user_id, line_blocked_at")
    .eq("id", driver.identity_id as string)
    .maybeSingle();
  if (!identity?.line_user_id) return null;

  return {
    driverId: driver.id as string,
    name: driver.name as string,
    identityId: identity.id as string,
    lineUserId: identity.line_user_id as string,
    blocked: Boolean(identity.line_blocked_at),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ driverId: string }> },
) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { driverId } = await params;

  const recipient = await resolveRecipient(orgId, driverId);
  if (!recipient) {
    return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
  }

  const { data: messages, error } = await supabase
    .from("line_chat_messages")
    .select("id, direction, text, created_at, sent_by")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[chat] 履歴取得に失敗", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    driver: { id: recipient.driverId, name: recipient.name, blocked: recipient.blocked },
    messages: messages ?? [],
  });
}

// PATCH: inbound の既読化。GET の副作用として毎ポーリング書き込んでいたのを分離した。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ driverId: string }> },
) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { driverId } = await params;

  const { error } = await supabase
    .from("line_chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("direction", "inbound")
    .is("read_at", null);
  if (error) {
    console.error("[chat] 既読化に失敗", error);
    return NextResponse.json({ error: "既読化に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ driverId: string }> },
) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { driverId } = await params;

  if (!isLineConfigured()) {
    return NextResponse.json({ error: "LINE連携が未設定です" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: `本文は${MAX_TEXT}文字までです` }, { status: 400 });
  }

  // org 越境と、未連携相手への送信をここで止める
  const recipient = await resolveRecipient(orgId, driverId);
  if (!recipient) {
    return NextResponse.json({ error: "この相手にはLINEを送信できません" }, { status: 404 });
  }
  if (recipient.blocked) {
    return NextResponse.json(
      { error: "相手が公式アカウントをブロックしているため送信できません" },
      { status: 409 },
    );
  }

  try {
    await pushText(recipient.lineUserId, text);
  } catch (e) {
    console.error("[chat] LINE送信に失敗", e);
    return NextResponse.json({ error: "LINEへの送信に失敗しました" }, { status: 502 });
  }

  // 送信できたものだけ履歴に残す（失敗を送信済みとして見せない）
  const { data: saved, error } = await supabase
    .from("line_chat_messages")
    .insert({
      org_id: orgId,
      driver_id: recipient.driverId,
      identity_id: recipient.identityId,
      direction: "outbound",
      text,
      sent_by: user.driverId,
    })
    .select("id, direction, text, created_at, sent_by")
    .single();
  if (error) console.error("[chat] 履歴の保存に失敗", error);

  return NextResponse.json({ ok: true, message: saved ?? null });
}
