import { NextRequest, NextResponse } from "next/server";
import { CAPABILITIES, isAuthError, requirePermission } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(req, "can_manage_members");
  if (isAuthError(actor)) return actor;
  const body = await req.json().catch(() => null);
  const capability = body?.capability;
  const enabled = body?.enabled;
  if (typeof capability !== "string" || !CAPABILITIES.some((item) => item === capability) || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "権限を確認してください" }, { status: 400 });
  }
  if (capability === "can_view_profit" && enabled) return NextResponse.json({ error: "利益の閲覧は経営・経理の役割で設定してください" }, { status: 400 });
  // 自分が持たない権限を第三者へ付けられない。剥奪も同じ条件にする。
  if (!actor.capabilities?.has(capability as typeof CAPABILITIES[number])) {
    return NextResponse.json({ error: "この権限は変更できません" }, { status: 403 });
  }
  if (!actor.orgId) return NextResponse.json({ error: "所属を確認できません" }, { status: 403 });
  const { id } = await params;
  const { error } = await supabase.rpc("set_member_capability_grant", {
    p_org: actor.orgId, p_actor: actor.driverId, p_target: id, p_capability: capability, p_enabled: enabled,
  });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
    if (error.code === "P0001") return NextResponse.json({ error: "権限を確認できません" }, { status: 403 });
    return NextResponse.json({ error: "権限を保存できませんでした" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
