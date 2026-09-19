import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { requireRecentAuth } from "@/server/auth/recentAuth";
import { reauthIdentity } from "@/server/auth/reauthIdentity";
import { supabase } from "@/server/db/client";
import { afterSafely } from "@/server/afterSafely";
import { deliverStoredNotifications } from "@/server/notifications/dispatch";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (!user.identityId) return NextResponse.json({ error: "本人情報がありません" }, { status: 400 });
  try {
    const [{ data, error }, identity] = await Promise.all([
      supabase.from("passkey_credentials").select("id, name, created_at, last_used_at")
        .eq("identity_id", user.identityId).order("created_at", { ascending: false }),
      reauthIdentity(user.identityId),
    ]);
    if (error) throw error;
    return NextResponse.json({ keys: data ?? [], canRecoverWithSms: !!identity.phone }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Passkeyの一覧を読み込めませんでした" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (!user.orgId) return NextResponse.json({ error: "所属を確認できません" }, { status: 403 });
  const orgId = user.orgId;
  const reauthError = await requireRecentAuth(req, user);
  if (reauthError) return reauthError;
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
    return NextResponse.json({ error: "削除するPasskeyを選んでください" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("manage_passkey", {
    p_driver_id: user.driverId, p_identity_id: user.identityId, p_org_id: user.orgId,
    p_operation: "delete", p_key_id: body.id,
  });
  if (error || !data?.notificationId) {
    const status = error?.code === "P0002" ? 404 : error?.code === "P0001" ? 409 : 503;
    return NextResponse.json({ error: status === 409 ? "最後のPasskeyです。先に電話番号を確認するか、別のPasskeyを登録してください"
      : status === 404 ? "Passkeyが見つかりません" : "削除できませんでした。時間をおいてお試しください" }, { status });
  }
  afterSafely(() => deliverStoredNotifications(orgId, [data.notificationId]));
  return NextResponse.json({ ok: true });
}
