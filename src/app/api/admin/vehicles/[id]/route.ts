import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PUT: 車両情報更新
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { name, currentMileage, lastOilChangeMileage, oilChangeInterval } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (currentMileage !== undefined) updates.current_mileage = currentMileage;
    if (lastOilChangeMileage !== undefined) updates.last_oil_change_mileage = lastOilChangeMileage;
    if (oilChangeInterval !== undefined) updates.oil_change_interval = oilChangeInterval;

    const { error } = await supabase
      .from("vehicles")
      .update(updates)
      .eq("id", params.id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: 車両削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { error } = await supabase.from("vehicles").delete().eq("id", params.id);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
