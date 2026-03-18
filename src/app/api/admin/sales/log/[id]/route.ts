import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type UpdateEntryBody = {
  log_date?: string;
  type_id?: string;
  content?: string;
  revenue?: number;
  profit?: number;
  amount?: number; // 互換（=profit）
  attribution?: "COMPANY" | "DRIVER";
  target_driver_id?: string | null;
  vehicle_id?: string | null;
  memo?: string | null;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  let body: UpdateEntryBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.log_date != null) updates.log_date = body.log_date;
  if (body.type_id != null) updates.type_id = body.type_id;
  if (body.content != null) updates.content = String(body.content).trim() || "";
  if (typeof body.revenue === "number") updates.revenue = Math.max(0, Math.trunc(body.revenue));
  if (typeof body.profit === "number") {
    const p = Math.trunc(body.profit);
    updates.profit = p;
    updates.amount = p; // 互換（profit）
  } else if (typeof body.amount === "number") {
    const p = Math.trunc(body.amount);
    updates.profit = p;
    updates.amount = p;
  }
  if (body.attribution != null) updates.attribution = body.attribution === "DRIVER" ? "DRIVER" : "COMPANY";
  if (body.target_driver_id !== undefined) updates.target_driver_id = body.target_driver_id || null;
  if (body.vehicle_id !== undefined) updates.vehicle_id = body.vehicle_id || null;
  if (body.memo !== undefined) updates.memo = body.memo?.trim() || null;

  const { data, error } = await supabase
    .from("sales_log_entries")
    .update(updates)
    .eq("id", id)
    .select("id, log_date, type_id, content, revenue, profit, amount, attribution, target_driver_id, vehicle_id, memo, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(_req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase.from("sales_log_entries").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
