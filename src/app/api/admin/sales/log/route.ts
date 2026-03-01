import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type SalesLogRow = {
  id: string;
  log_date: string;
  driver_payment: number;
  vehicle_repair: number;
  oil_change: number;
  one_off_amount: number;
  one_off_memo: string | null;
};

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

  const { data, error } = await supabase
    .from("sales_log")
    .select("id, log_date, driver_payment, vehicle_repair, oil_change, one_off_amount, one_off_memo")
    .gte("log_date", startParam)
    .lte("log_date", endParam)
    .order("log_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (data ?? []) as SalesLogRow[];
  return NextResponse.json({ entries });
}

type LogEntryInput = {
  log_date: string;
  driver_payment?: number;
  vehicle_repair?: number;
  oil_change?: number;
  one_off_amount?: number;
  one_off_memo?: string | null;
};

export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  let body: { entries?: LogEntryInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entries = body.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "entries array is required" }, { status: 400 });
  }

  for (const e of entries) {
    if (!e.log_date || typeof e.log_date !== "string") {
      return NextResponse.json({ error: "Each entry must have log_date (YYYY-MM-DD)" }, { status: 400 });
    }
  }

  const upserts = entries.map((e) => ({
    log_date: e.log_date,
    driver_payment: Number(e.driver_payment) || 0,
    vehicle_repair: Number(e.vehicle_repair) || 0,
    oil_change: Number(e.oil_change) || 0,
    one_off_amount: Number(e.one_off_amount) || 0,
    one_off_memo: e.one_off_memo ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("sales_log").upsert(upserts, {
    onConflict: "log_date",
    ignoreDuplicates: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
