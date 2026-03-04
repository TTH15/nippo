import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type DriverFixedExpense = {
  id: string;
  driver_id: string;
  name: string;
  amount: number;
  cycle: "MONTHLY";
  valid_from: string;
  valid_to: string | null;
};

// GET: ドライバーごとの固定経費一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driver_id");
  if (!driverId) {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("driver_fixed_expenses")
    .select("id, driver_id, name, amount, cycle, valid_from, valid_to")
    .eq("driver_id", driverId)
    .order("valid_from", { ascending: true });

  if (error) {
    console.error("[/api/admin/driver-expenses] GET error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const expenses: DriverFixedExpense[] = (data ?? []).map((row: any) => ({
    id: String(row.id ?? ""),
    driver_id: String(row.driver_id ?? ""),
    name: String(row.name ?? ""),
    amount: Number(row.amount) || 0,
    cycle: "MONTHLY",
    valid_from: String(row.valid_from ?? ""),
    valid_to: row.valid_to ? String(row.valid_to) : null,
  }));

  return NextResponse.json({ expenses });
}

// POST: 固定経費の新規登録
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  type Body = {
    driver_id?: string;
    name?: string;
    amount?: number;
    cycle?: "MONTHLY";
    valid_from?: string;
    valid_to?: string | null;
  };

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { driver_id, name, amount, cycle, valid_from, valid_to } = body;

  if (!driver_id || typeof driver_id !== "string") {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "経費名を入力してください" }, { status: 400 });
  }
  if (amount == null || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json({ error: "月額は1円以上の数値で入力してください" }, { status: 400 });
  }

  const cycleValue: "MONTHLY" = cycle === "MONTHLY" || cycle == null ? "MONTHLY" : "MONTHLY";

  const payload: Record<string, unknown> = {
    driver_id,
    name: name.trim(),
    amount: Math.floor(Number(amount)),
    cycle: cycleValue,
  };

  if (valid_from && typeof valid_from === "string") {
    payload.valid_from = valid_from;
  }
  if (valid_to !== undefined) {
    payload.valid_to = valid_to || null;
  }

  const { data, error } = await supabase
    .from("driver_fixed_expenses")
    .insert(payload)
    .select("id, driver_id, name, amount, cycle, valid_from, valid_to")
    .single();

  if (error) {
    console.error("[/api/admin/driver-expenses] POST error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const expense: DriverFixedExpense = {
    id: String(data.id ?? ""),
    driver_id: String(data.driver_id ?? ""),
    name: String(data.name ?? ""),
    amount: Number(data.amount) || 0,
    cycle: "MONTHLY",
    valid_from: String(data.valid_from ?? ""),
    valid_to: data.valid_to ? String(data.valid_to) : null,
  };

  return NextResponse.json({ expense });
}

