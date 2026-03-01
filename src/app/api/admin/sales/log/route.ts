import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export type SalesLogEntryRow = {
  id: string;
  log_date: string;
  type_id: string;
  type_name: string;
  content: string;
  amount: number;
  attribution: "COMPANY" | "DRIVER";
  target_driver_id: string | null;
  target_driver_name: string | null;
  vehicle_id: string | null;
  vehicle_label: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

// GET: 期間内のログ明細（種別名・ドライバー名・車両ラベル付き）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

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
      id, log_date, type_id, content, amount, attribution,
      target_driver_id, vehicle_id, memo, created_at, updated_at,
      sales_log_types ( name ),
      drivers ( id, name, display_name ),
      vehicles ( id, manufacturer, brand, number_numeric )
    `)
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
      id: r.id,
      log_date: r.log_date,
      type_id: r.type_id,
      type_name: type?.name ?? "",
      content: r.content,
      amount: Number(r.amount),
      attribution: (r.attribution as "COMPANY" | "DRIVER") || "COMPANY",
      target_driver_id: r.target_driver_id as string | null,
      target_driver_name: driver ? (driver.display_name || driver.name) : null,
      vehicle_id: r.vehicle_id as string | null,
      vehicle_label: vehicleLabel,
      memo: r.memo as string | null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  return NextResponse.json({ entries });
}

type CreateEntryBody = {
  log_date: string;
  type_id: string;
  content: string;
  amount: number;
  attribution?: "COMPANY" | "DRIVER";
  target_driver_id?: string | null;
  vehicle_id?: string | null;
  memo?: string | null;
};

// POST: 1件追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

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
    amount: Number(body.amount) || 0,
    attribution: body.attribution === "DRIVER" ? "DRIVER" : "COMPANY",
    target_driver_id: body.target_driver_id || null,
    vehicle_id: body.vehicle_id || null,
    memo: body.memo?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("sales_log_entries")
    .insert(payload)
    .select("id, log_date, type_id, content, amount, attribution, target_driver_id, vehicle_id, memo, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}
