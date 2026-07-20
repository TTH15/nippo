import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";
import { getVapidPublicKey, isWebPushConfigured } from "@/server/notifications/webpush";

export const dynamic = "force-dynamic";

// ============================================================
// Web Push の購読管理（roadmap-2026-07 E⑦）。
// GET    : 公開鍵と、この端末が購読済みかの判定材料
// POST   : 購読の登録（同じ endpoint は upsert＝再許可でも重複しない）
// DELETE : 購読の解除（endpoint 指定）
// 購読は identity 単位で束ねた端末ごとの行。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  const configured = isWebPushConfigured();

  if (!configured || !identityId) {
    return NextResponse.json({ configured, publicKey: null, subscriptionCount: 0 });
  }

  const { count } = await supabase
    .from("push_subscriptions")
    .select("endpoint", { count: "exact", head: true })
    .eq("identity_id", identityId);

  return NextResponse.json({
    configured,
    publicKey: getVapidPublicKey(),
    subscriptionCount: count ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: "通知は現在利用できません" }, { status: 503 });
  }

  const identityId = await resolveIdentityId(user);
  if (!identityId) {
    return NextResponse.json({ error: "identityが未設定です" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const { endpoint, keys } = body;
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    return NextResponse.json({ error: "購読情報が不正です" }, { status: 400 });
  }

  // 同一端末の再購読・別アカウントでの再ログインは endpoint 単位で上書きする
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint,
      identity_id: identityId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error("[me/push] 購読の保存に失敗", error);
    return NextResponse.json({ error: "通知の登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint を指定してください" }, { status: 400 });
  }

  // 自分の購読しか消せないよう identity でも絞る
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("identity_id", identityId);
  if (error) {
    console.error("[me/push] 購読の削除に失敗", error);
    return NextResponse.json({ error: "通知の解除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
