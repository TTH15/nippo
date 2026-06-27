import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { syncSalesLogDriverReward } from "@/server/salesLogDriverReward";

export const dynamic = "force-dynamic";

type UpdateEntryBody = {
  log_date?: string;
  type_id?: string;
  content?: string;
  revenue?: number;
  profit?: number;
  amount?: number; // 互換（=profit）
  target_driver_id?: string | null;
  vehicle_id?: string | null;
  memo?: string | null;
  counterparty_invoice_address_id?: string | null;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

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
  if (body.target_driver_id !== undefined) updates.target_driver_id = body.target_driver_id || null;
  if (body.vehicle_id !== undefined) updates.vehicle_id = body.vehicle_id || null;
  if (body.memo !== undefined) updates.memo = body.memo?.trim() || null;
  if (body.counterparty_invoice_address_id !== undefined) {
    updates.counterparty_invoice_address_id =
      typeof body.counterparty_invoice_address_id === "string" && body.counterparty_invoice_address_id.trim()
        ? body.counterparty_invoice_address_id.trim()
        : null;
  }

  const { data: before, error: beforeErr } = await supabase
    .from("sales_log_entries")
    .select(
      "log_date, type_id, content, revenue, profit, amount, attribution, target_driver_id, vehicle_id, memo, counterparty_invoice_address_id",
    )
    .eq("id", id)
    .single();

  if (beforeErr || !before) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("sales_log_entries")
    .update(updates)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, log_date, type_id, content, revenue, profit, amount, attribution, target_driver_id, vehicle_id, memo, counterparty_invoice_address_id, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await syncSalesLogDriverReward(supabase, orgId, {
      id: data.id,
      log_date: String(data.log_date ?? ""),
      revenue: Number((data as { revenue?: number }).revenue) || 0,
      profit: Number((data as { profit?: number; amount?: number }).profit ?? (data as { amount?: number }).amount) || 0,
      target_driver_id: (data.target_driver_id as string | null) ?? null,
      content: String(data.content ?? ""),
    });
  } catch (syncErr) {
    console.error("[sales/log PATCH] syncSalesLogDriverReward", syncErr);
    const b = before as Record<string, unknown>;
    await supabase
      .from("sales_log_entries")
      .update({
        log_date: b.log_date,
        type_id: b.type_id,
        content: b.content,
        revenue: b.revenue,
        profit: b.profit,
        amount: b.amount,
        attribution: b.attribution,
        target_driver_id: b.target_driver_id,
        vehicle_id: b.vehicle_id,
        memo: b.memo,
        counterparty_invoice_address_id: b.counterparty_invoice_address_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("org_id", orgId);
    return NextResponse.json(
      { error: "ドライバー報酬の同期に失敗しました。もう一度お試しください。" },
      { status: 500 },
    );
  }

  return NextResponse.json({ entry: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(_req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase.from("sales_log_entries").delete().eq("id", id).eq("org_id", orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
