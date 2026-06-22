import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type OptionalExpense = {
  id: string;
  driver_id: string;
  month: string;
  name: string;
  amount: number;
};

// GET: 指定月の自由経費一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("driver_optional_expenses")
    .select("id, driver_id, month, name, amount")
    .eq("driver_id", user.driverId)
    .eq("month", month)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[/api/me/optional-expenses] GET error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const expenses: OptionalExpense[] = (data ?? []).map((row: any) => ({
    id: String(row.id ?? ""),
    driver_id: String(row.driver_id ?? ""),
    month: String(row.month ?? ""),
    name: String(row.name ?? ""),
    amount: Number(row.amount) || 0,
  }));

  return NextResponse.json({ expenses });
}

// POST: 自由経費を1件追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  type Body = { month?: string; name?: string; amount?: number };

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { month, name, amount } = body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "経費名を入力してください" }, { status: 400 });
  }
  if (amount == null || Number.isNaN(Number(amount)) || Number(amount) < 0) {
    return NextResponse.json({ error: "金額は0以上の数値で入力してください" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("driver_optional_expenses")
    .insert({
      driver_id: user.driverId,
      month,
      name: name.trim(),
      amount: Math.floor(Number(amount)),
      updated_at: new Date().toISOString(),
    })
    .select("id, driver_id, month, name, amount")
    .single();

  if (error) {
    console.error("[/api/me/optional-expenses] POST error", error);
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
