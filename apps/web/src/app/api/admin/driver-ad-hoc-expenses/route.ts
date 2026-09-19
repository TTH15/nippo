import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveOrgId } from "@/server/db/tenant";
import { belongsToOrg } from "@/server/db/adminResourceScope";

export const dynamic = "force-dynamic";

type AdHocExpense = {
  id: string;
  driver_id: string;
  month: string;
  name: string;
  amount: number;
};

// GET: 指定ドライバー・月の臨時経費一覧
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_rewards");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driver_id");
  const month = req.nextUrl.searchParams.get("month");
  if (!driverId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "driver_id and month (YYYY-MM) are required" },
      { status: 400 }
    );
  }

  // ★driver_id はクエリ由来。自社のドライバーでなければ他社の経費（金額つき）が読めてしまう。
  if (!(await belongsToOrg("drivers", driverId, await resolveOrgId(user.driverId)))) {
    return NextResponse.json({ error: "対象のドライバーが見つかりません。" }, { status: 404 });
  }

  const { data, error } = await supabase
    // tenant-scope-ok: 直上の belongsToOrg で自社のドライバーと確認済みの driverId に固定
    .from("driver_ad_hoc_expenses")
    .select("id, driver_id, month, name, amount")
    .eq("driver_id", driverId)
    .eq("month", month)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[/api/admin/driver-ad-hoc-expenses] GET error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const expenses: AdHocExpense[] = (data ?? []).map((row: any) => ({
    id: String(row.id ?? ""),
    driver_id: String(row.driver_id ?? ""),
    month: String(row.month ?? ""),
    name: String(row.name ?? ""),
    amount: Number(row.amount) || 0,
  }));

  return NextResponse.json({ expenses });
}

// POST: 臨時経費を1件追加
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_rewards");
  if (isAuthError(user)) return user;

  type Body = { driver_id?: string; month?: string; name?: string; amount?: number };

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { driver_id, month, name, amount } = body;
  if (!driver_id || typeof driver_id !== "string") {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "経費名を入力してください" }, { status: 400 });
  }
  // amount は符号付き（＋=控除、−=手当/加算）。0 は不可。
  if (amount == null || Number.isNaN(Number(amount)) || Number(amount) === 0) {
    return NextResponse.json({ error: "金額は0以外の数値で入力してください" }, { status: 400 });
  }

  // ★driver_id は body 由来。自社のドライバーでなければ他社の報酬に経費を足せてしまう。
  if (!(await belongsToOrg("drivers", driver_id, await resolveOrgId(user.driverId)))) {
    return NextResponse.json({ error: "対象のドライバーが見つかりません。" }, { status: 404 });
  }

  const { data, error } = await supabase
    // tenant-scope-ok: 直上の belongsToOrg で自社のドライバーと確認済みの driver_id
    .from("driver_ad_hoc_expenses")
    .insert({
      driver_id,
      month,
      name: name.trim(),
      amount: Math.trunc(Number(amount)),
      updated_at: new Date().toISOString(),
    })
    .select("id, driver_id, month, name, amount")
    .single();

  if (error) {
    console.error("[/api/admin/driver-ad-hoc-expenses] POST error", error);
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
