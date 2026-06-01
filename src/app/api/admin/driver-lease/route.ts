import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// ドライバーごとのリース設定（driver_leases）。専用概念。
//   GET ?driver_id=  → 現在有効なリース（無ければ null）
//   PUT              → 現在のリースを upsert（enabled=false で解除）
// driver_fixed_expenses route のパターン踏襲。
// ============================================================

type LeaseDto = {
  id: string;
  driver_id: string;
  mode: "MONTHLY" | "DAILY";
  amount: number;
  valid_from: string;
  valid_to: string | null;
};

/** "YYYY-MM-01" の前日（前月末日）を "YYYY-MM-DD" で返す */
function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function currentMonthStart(): string {
  const now = new Date();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${mm}-01`;
}

// GET: 現在有効なリース（valid_to が NULL または未来）。複数あれば valid_from 最新。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driver_id");
  if (!driverId) {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("driver_leases")
    .select("id, driver_id, mode, amount, valid_from, valid_to")
    .eq("driver_id", driverId)
    .is("valid_to", null)
    .order("valid_from", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[/api/admin/driver-lease] GET error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const row = (data ?? [])[0];
  const lease: LeaseDto | null = row
    ? {
        id: String(row.id ?? ""),
        driver_id: String(row.driver_id ?? ""),
        mode: row.mode === "DAILY" ? "DAILY" : "MONTHLY",
        amount: Number(row.amount) || 0,
        valid_from: String(row.valid_from ?? ""),
        valid_to: row.valid_to ? String(row.valid_to) : null,
      }
    : null;

  return NextResponse.json({ lease });
}

// PUT: リースの設定/更新/解除
export async function PUT(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  type Body = {
    driver_id?: string;
    enabled?: boolean;
    mode?: "MONTHLY" | "DAILY";
    amount?: number;
    valid_from?: string;
  };

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { driver_id } = body;
  if (!driver_id || typeof driver_id !== "string") {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }

  const validFrom =
    body.valid_from && /^\d{4}-\d{2}-\d{2}$/.test(body.valid_from) ? body.valid_from : currentMonthStart();

  // 既存の有効期間（valid_to が NULL）を当該開始の前日で閉じる
  const { error: closeErr } = await supabase
    .from("driver_leases")
    .update({ valid_to: dayBefore(validFrom), updated_at: new Date().toISOString() })
    .eq("driver_id", driver_id)
    .is("valid_to", null)
    .lt("valid_from", validFrom);
  if (closeErr) {
    console.error("[/api/admin/driver-lease] close error", closeErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 同月（同 valid_from）の既存行は置き換えのため削除
  const { error: delErr } = await supabase
    .from("driver_leases")
    .delete()
    .eq("driver_id", driver_id)
    .eq("valid_from", validFrom);
  if (delErr) {
    console.error("[/api/admin/driver-lease] replace-delete error", delErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const mode: "MONTHLY" | "DAILY" = body.mode === "DAILY" ? "DAILY" : "MONTHLY";
  const amount = Math.max(0, Math.trunc(Number(body.amount) || 0));

  // 解除（enabled=false）/ 月額で金額0 の場合はここで終了＝リース無し。
  // 日額は金額をコース(daily_lease)が持つため amount=0 でも有効。
  if (body.enabled === false || (mode === "MONTHLY" && amount <= 0)) {
    return NextResponse.json({ lease: null });
  }

  const { data, error } = await supabase
    .from("driver_leases")
    .insert({ driver_id, mode, amount, valid_from: validFrom })
    .select("id, driver_id, mode, amount, valid_from, valid_to")
    .single();

  if (error) {
    console.error("[/api/admin/driver-lease] insert error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const lease: LeaseDto = {
    id: String(data.id ?? ""),
    driver_id: String(data.driver_id ?? ""),
    mode: data.mode === "DAILY" ? "DAILY" : "MONTHLY",
    amount: Number(data.amount) || 0,
    valid_from: String(data.valid_from ?? ""),
    valid_to: data.valid_to ? String(data.valid_to) : null,
  };

  return NextResponse.json({ lease });
}
