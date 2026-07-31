import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: 取り込みバッチの取り消し。
// そのバッチで登録された shifts 行をまとめて削除する（手動編集された行も出自がこのバッチなら消える点は許容）。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  try {
    const { id } = await params;
    const orgId = await resolveOrgId(user.driverId);

    const { data: batch } = await supabase
      .from("shift_import_batches")
      .select("id, org_id, reverted_at")
      .eq("id", id)
      .single();
    if (!batch || batch.org_id !== orgId) {
      return NextResponse.json({ error: "batch not found" }, { status: 404 });
    }
    if (batch.reverted_at) {
      return NextResponse.json({ error: "既に取り消し済みです" }, { status: 400 });
    }

    const { data: removed, error } = await supabase
      .from("shifts")
      .delete()
      .eq("import_batch_id", id)
      .select("id");
    if (error) throw error;

    await supabase
      .from("shift_import_batches")
      .update({ reverted_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ removed: (removed ?? []).length });
  } catch (err) {
    console.error("[admin/shifts/import/batches/revert] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
