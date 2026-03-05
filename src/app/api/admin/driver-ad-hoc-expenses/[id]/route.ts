import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PATCH: 臨時経費を更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  let body: { name?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = await params;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "経費名を入力してください" }, { status: 400 });
    }
    updates.name = body.name.trim();
  }
  if (body.amount !== undefined) {
    const value = Number(body.amount);
    if (Number.isNaN(value) || value < 0) {
      return NextResponse.json({ error: "金額は0以上の数値で入力してください" }, { status: 400 });
    }
    updates.amount = Math.floor(value);
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("driver_ad_hoc_expenses")
    .update(updates)
    .eq("id", id)
    .select("id, driver_id, month, name, amount")
    .single();

  if (error) {
    console.error("[/api/admin/driver-ad-hoc-expenses/[id]] PATCH error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    expense: {
      id: String(data.id ?? ""),
      driver_id: String(data.driver_id ?? ""),
      month: String(data.month ?? ""),
      name: String(data.name ?? ""),
      amount: Number(data.amount) || 0,
    },
  });
}

// DELETE: 臨時経費を削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;

  const { error } = await supabase.from("driver_ad_hoc_expenses").delete().eq("id", id);

  if (error) {
    console.error("[/api/admin/driver-ad-hoc-expenses/[id]] DELETE error", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
