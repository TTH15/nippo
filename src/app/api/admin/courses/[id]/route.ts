import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// DELETE: コース削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = params;

  try {
    // 関連レコードを先に削除
    await supabase.from("driver_courses").delete().eq("course_id", id);
    await supabase.from("course_rates").delete().eq("course_id", id);
    await supabase.from("shifts").delete().eq("course_id", id);

    const { error } = await supabase.from("courses").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

