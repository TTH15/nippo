import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { syncSalesLogDriverReward } from "@/server/salesLogDriverReward";

export const dynamic = "force-dynamic";

export type SalesLogEntryRow = {
  id: string;
  log_date: string;
  type_id: string;
  type_name: string;
  content: string;
  revenue: number;
  profit: number;
  amount: number; // 互換用（=profit）
  attribution: "COMPANY" | "DRIVER";
  target_driver_id: string | null;
  target_driver_name: string | null;
  vehicle_id: string | null;
  vehicle_label: string | null;
  memo: string | null;
  counterparty_invoice_address_id: string | null;
  created_at: string;
  updated_at: string;
};

// GET: 期間内のログ明細（種別名・ドライバー名・車両ラベル付き）
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  if (!startParam || !endParam) {
    return NextResponse.json(
      { error: "start and end (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  const { data: rows, error } = await supabase
    .from("sales_log_entries")
    .select(`
      id, log_date, type_id, content, revenue, profit, amount, attribution,
      target_driver_id, vehicle_id, memo, counterparty_invoice_address_id, created_at, updated_at,
      sales_log_types ( name ),
      drivers ( id, name, display_name ),
      vehicles ( id, manufacturer, brand, number_numeric )
    `)
    .eq("org_id", orgId)
    .gte("log_date", startParam)
    .lte("log_date", endParam)
    .order("log_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries: SalesLogEntryRow[] = (rows ?? []).map((r: Record<string, unknown>) => {
    const type = r.sales_log_types as { name: string } | null;
    const driver = r.drivers as { id: string; name: string; display_name?: string | null } | null;
    const vehicle = r.vehicles as { id: string; manufacturer?: string | null; brand?: string | null; number_numeric?: string | null } | null;
    const vehicleLabel = vehicle
      ? [vehicle.manufacturer, vehicle.brand, vehicle.number_numeric].filter(Boolean).join(" ") || null
      : null;
    return {
      id: String(r.id ?? ""),
      log_date: String(r.log_date ?? ""),
      type_id: String(r.type_id ?? ""),
      type_name: type?.name ?? "",
      content: String(r.content ?? ""),
      revenue: Number((r as any).revenue ?? 0) || 0,
      profit: Number((r as any).profit ?? r.amount ?? 0) || 0,
      amount: Number(r.amount), // 互換（profit）
      attribution: (r.attribution as "COMPANY" | "DRIVER") || "COMPANY",
      target_driver_id: (r.target_driver_id as string) || null,
      target_driver_name: driver ? (driver.display_name || driver.name) : null,
      vehicle_id: (r.vehicle_id as string) || null,
      vehicle_label: vehicleLabel,
      memo: (r.memo as string) || null,
      counterparty_invoice_address_id: (r.counterparty_invoice_address_id as string) || null,
      created_at: String(r.created_at ?? ""),
      updated_at: String(r.updated_at ?? ""),
    };
  });

  return NextResponse.json({ entries });
}

type CreateEntryBody = {
  log_date: string;
  type_id: string;
  content: string;
  revenue?: number;
  profit?: number;
  amount?: number; // 互換
  target_driver_id?: string | null;
  vehicle_id?: string | null;
  memo?: string | null;
  counterparty_invoice_address_id?: string | null;
};

// POST: 1件追加
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  let body: CreateEntryBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.log_date || !body.type_id || body.content == null) {
    return NextResponse.json(
      { error: "log_date, type_id, content are required" },
      { status: 400 },
    );
  }

  const payload = {
    log_date: body.log_date,
    type_id: body.type_id,
    content: String(body.content).trim() || "",
    revenue: Math.trunc(Number(body.revenue) || 0),
    profit: Math.trunc(Number(body.profit ?? body.amount) || 0),
    amount: Math.trunc(Number(body.profit ?? body.amount) || 0), // 互換（profit）
    // 帰属先は内部的には COMPANY 固定（会社視点の損益）。ドライバー報酬は別途 driver_ad_hoc_expenses で管理する。
    attribution: "COMPANY" as const,
    target_driver_id: body.target_driver_id || null,
    vehicle_id: body.vehicle_id || null,
    memo: body.memo?.trim() || null,
    counterparty_invoice_address_id:
      typeof body.counterparty_invoice_address_id === "string" && body.counterparty_invoice_address_id.trim()
        ? body.counterparty_invoice_address_id.trim()
        : null,
    updated_at: new Date().toISOString(),
  };

  if (payload.revenue < 0) payload.revenue = 0;

  const { data, error } = await supabase
    .from("sales_log_entries")
    .insert({ ...payload, org_id: orgId })
    .select("id, log_date, type_id, content, revenue, profit, amount, attribution, target_driver_id, vehicle_id, memo, counterparty_invoice_address_id, created_at, updated_at")
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
    console.error("[sales/log POST] syncSalesLogDriverReward", syncErr);
    await supabase.from("sales_log_entries").delete().eq("id", data.id);
    return NextResponse.json(
      { error: "ドライバー報酬の同期に失敗しました。もう一度お試しください。" },
      { status: 500 },
    );
  }

  return NextResponse.json({ entry: data });
}
