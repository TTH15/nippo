import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PUT: コース名・色の更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { name, color } = body as { name?: string; color?: string };

    const updates: Record<string, unknown> = {};
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      updates.name = trimmed;
    }
    if (typeof color === "string") {
      updates.color = color;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase
      .from("courses")
      .update(updates)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: コース削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

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

