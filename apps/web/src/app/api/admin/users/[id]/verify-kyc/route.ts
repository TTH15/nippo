import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// 本承認（本人確認）: action='approve' で kyc_verified_at を刻む / 'reject' で却下。
// ADMIN のみ・org ガード。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: driverId } = await params;

  const body = await req.json().catch(() => ({}));
  const action = body.action === "reject" ? "reject" : "approve";

  if (action === "reject") {
    const { error } = await supabase
      .from("drivers")
      .update({ status: "rejected" })
      .eq("id", driverId)
      .eq("org_id", orgId);
    if (error) {
      console.error("[verify-kyc] reject", error);
      return NextResponse.json({ error: "却下に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // approve: active かつ未本承認のときのみ。
  const { data, error } = await supabase
    .from("drivers")
    .update({ kyc_verified_at: new Date().toISOString(), kyc_verified_by: user.driverId })
    .eq("id", driverId)
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("kyc_verified_at", null)
    .select("id");
  if (error) {
    console.error("[verify-kyc] approve", error);
    return NextResponse.json({ error: "本承認に失敗しました" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "対象が見つからない、または既に処理済みです" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
