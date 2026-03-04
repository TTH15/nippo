import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PATCH: 固定経費の更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  let body: {
    name?: string;
    amount?: number;
    cycle?: "MONTHLY";
    valid_from?: string;
    valid_to?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = await params;

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "経費名を入力してください" }, { status: 400 });
    }
    updates.name = body.name.trim();
  }

  if (body.amount !== undefined) {
    const value = Number(body.amount);
    if (Number.isNaN(value) || value <= 0) {
      return NextResponse.json(
        { error: "月額は1円以上の数値で入力してください" },
        { status: 400 },
      );
    }
    updates.amount = Math.floor(value);
  }

  if (body.cycle !== undefined) {
    updates.cycle = "MONTHLY";
  }

  if (body.valid_from !== undefined) {
    updates.valid_from =
      typeof body.valid_from === "string" && body.valid_from
        ? body.valid_from
        : null;
  }

  if (body.valid_to !== undefined) {
    updates.valid_to =
      typeof body.valid_to === "string" && body.valid_to
        ? body.valid_to
        : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "更新する項目がありません" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("driver_fixed_expenses")
    .update(updates)
    .eq("id", id)
    .select("id, driver_id, name, amount, cycle, valid_from, valid_to")
    .single();

  if (error) {
    console.error("[/api/admin/driver-expenses/[id]] PATCH error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    expense: {
      id: String(data.id ?? ""),
      driver_id: String(data.driver_id ?? ""),
      name: String(data.name ?? ""),
      amount: Number(data.amount) || 0,
      cycle: "MONTHLY" as const,
      valid_from: String(data.valid_from ?? ""),
      valid_to: data.valid_to ? String(data.valid_to) : null,
    },
  });
}

// DELETE: 固定経費の削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;

  const { error } = await supabase
    .from("driver_fixed_expenses")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[/api/admin/driver-expenses/[id]] DELETE error", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

