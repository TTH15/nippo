import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 運営が「確認済みの電話番号」の紐付けを解除する。
// identities.phone/phone_verified_at はドライバー本人のSMS OTP確認でしか埋まらない設計
// （/api/me/phone/verify）のため、番号を変え直したい場合は運営がここで一度削除し、
// ドライバー本人にマイページから再確認してもらう。
// ============================================================

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { id: driverId } = await params;

  const { data: driverRow, error: driverFetchErr } = await supabase
    .from("drivers")
    .select("id, identity_id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .single();

  if (driverFetchErr || !driverRow) {
    return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
  }

  if (driverRow.identity_id) {
    const { error: identityErr } = await supabase
      .from("identities")
      .update({ phone: null, phone_verified_at: null })
      .eq("id", driverRow.identity_id);
    if (identityErr) {
      console.error("[Admin phone unlink] identities update error:", identityErr);
      return NextResponse.json({ error: "電話番号の削除に失敗しました" }, { status: 500 });
    }
  }

  await supabase.from("drivers").update({ phone: null }).eq("id", driverId);

  return NextResponse.json({ ok: true });
}
