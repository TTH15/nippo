import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { requirePlatformAdmin, logPlatformAction, bootstrapOrganization } from "@/server/platform";

export const dynamic = "force-dynamic";

// 申請の審査アクション。
//   reviewing: 審査中へ / reject: 否認（decided_note 必須ではないが推奨）
//   approve: 承認 → org ブートストラップ（organizations + system ロール + 初代 ADMIN 招待）
// §2-5 のハイタッチフロー（導入相談等）は運用で担保し、ここでは台帳の状態遷移と発行だけを行う。

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformAdmin(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    action?: "reviewing" | "approve" | "reject";
    decidedNote?: string;
    orgName?: string;
    orgCode?: string;
  };

  const { data: app, error: appErr } = await supabase
    .from("org_applications")
    .select("id, company_name, status")
    .eq("id", id)
    .maybeSingle();
  if (appErr || !app) return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
  if (app.status === "approved") {
    return NextResponse.json({ error: "承認済みの申請は変更できません" }, { status: 400 });
  }

  if (body.action === "reviewing") {
    const { error } = await supabase.from("org_applications").update({ status: "reviewing" }).eq("id", id);
    if (error) return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    await logPlatformAction(ctx.identityId, "application.reviewing", id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reject") {
    const { error } = await supabase
      .from("org_applications")
      .update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        decided_by: ctx.identityId,
        decided_note: body.decidedNote ?? null,
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    await logPlatformAction(ctx.identityId, "application.reject", id, { note: body.decidedNote });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "approve") {
    const orgName = (body.orgName ?? app.company_name).trim();
    const orgCode = (body.orgCode ?? "").trim().toUpperCase();
    if (!orgCode || !/^[A-Z0-9]{2,10}$/.test(orgCode)) {
      return NextResponse.json({ error: "会社コード（英数2〜10文字）を指定してください" }, { status: 400 });
    }
    try {
      const result = await bootstrapOrganization({ name: orgName, code: orgCode, adminInviteName: "初代管理者" });
      const { error } = await supabase
        .from("org_applications")
        .update({
          status: "approved",
          decided_at: new Date().toISOString(),
          decided_by: ctx.identityId,
          decided_note: body.decidedNote ?? null,
          org_id: result.orgId,
        })
        .eq("id", id);
      if (error) {
        console.error("[platform/applications] 承認後の台帳更新に失敗", error);
      }
      await logPlatformAction(ctx.identityId, "application.approve", id, {
        orgId: result.orgId,
        orgCode,
        orgName,
      });
      // 招待トークンはこのレスポンスでのみ返す（保存表示はしない）
      return NextResponse.json({
        ok: true,
        orgId: result.orgId,
        joinCode: result.joinCode,
        adminInviteToken: result.adminInviteToken,
      });
    } catch (e) {
      console.error("[platform/applications] ブートストラップ失敗", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "org の発行に失敗しました" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "action を指定してください" }, { status: 400 });
}
