import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: ゲストメンバーを作成 { name }
// ゲスト = ログインしない membership（identity なし・works_as_driver=false）。
// シフト表の抽出には出ず、単発案件の参加者ピッカーにだけ出る（work-model §3）。
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "名前は1〜50文字で入力してください" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("drivers")
    .insert({
      org_id: orgId,
      name,
      role: "GUEST", // ラベルのみ（権限の正本は role_id。ゲストは role_id なし＝権限ゼロ）
      member_kind: "guest",
      works_as_driver: false,
      status: "active",
    })
    .select("id, name, display_name, member_kind")
    .single();

  if (error || !data) {
    console.error("[spot-jobs/guests] insert error", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({
    driver: { id: data.id, name: data.display_name || data.name, isGuest: true },
  });
}
